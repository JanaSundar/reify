import type { HeapEvent } from "../../../core/protocol/events";
import type { LocId } from "../../../core/protocol/program";
import type { ExecutionLimits } from "../../../core/protocol/limits";
import {
  primitive,
  ref,
  type EncodedValue,
  type HeapId,
  type HeapObject,
} from "../../../core/protocol/values";
import {
  collectionSize,
  encodePrimitive,
  functionName,
  isObjectLike,
  mapEntries,
  ownFields,
  readOwnData,
  setValues,
  shapeOf,
  typeNameOf,
  type JsObject,
} from "./jsValues";

export interface HeapSink {
  heap(object: HeapObject, via?: HeapEvent["via"]): void;
  write(id: HeapId, key: number | string, value: EncodedValue, loc: LocId): void;
}

const INTEGER_KEY = /^(?:0|[1-9]\d*)$/;

/** Canonical array index for a property key, or null. */
const arrayIndex = (key: unknown): number | null => {
  if (typeof key === "number") return Number.isInteger(key) && key >= 0 ? key : null;
  if (typeof key === "string" && INTEGER_KEY.test(key)) {
    const index = Number(key);
    return index < 2 ** 32 - 1 ? index : null;
  }
  return null;
};

const NOT_CAPTURED = primitive("other", "…");

/**
 * Converts JavaScript values into the neutral heap representation.
 *
 * Objects get stable ids on first sight (identity is preserved via a WeakMap). Encoding is
 * shallow + iterative: an object's newly seen children are captured in the same pass, but
 * known children are only referenced. Objects beyond the per-pass budget are deferred and
 * captured in full the next time they are touched.
 */
export class JsValueEncoder {
  private readonly ids = new WeakMap<JsObject, HeapId>();
  private readonly deferred = new WeakSet<JsObject>();
  private nextId = 1;

  constructor(
    private readonly limits: ExecutionLimits,
    private readonly sink: HeapSink,
  ) {}

  encode(value: unknown): EncodedValue {
    if (!isObjectLike(value)) return encodePrimitive(value, this.limits.maxStringLength);
    const known = this.ids.get(value);
    if (known !== undefined) return ref(known);
    return ref(this.captureNew([value]));
  }

  /** Re-captures an object after it was mutated in bulk (method call, delete, ...). */
  recapture(value: unknown, via?: HeapEvent["via"]): void {
    if (!isObjectLike(value)) return;
    const id = this.ids.get(value);
    if (id === undefined) {
      this.encode(value);
      return;
    }
    this.deferred.delete(value);
    const pending: JsObject[] = [];
    this.sink.heap(this.snapshot(value, id, pending), via);
    this.drain(pending);
  }

  /** Records `object[key]` after a write, as a slot update when possible. */
  write(object: unknown, key: unknown, loc: LocId): void {
    if (!isObjectLike(object)) return;
    const id = this.ids.get(object);
    if (id === undefined || this.deferred.has(object) || typeof key === "symbol") {
      this.recapture(object);
      return;
    }
    const shape = shapeOf(object);
    const own = readOwnData(object, key as PropertyKey);
    if (!own.found) {
      this.recapture(object, { l: loc, op: "write" });
      return;
    }
    const index = arrayIndex(key);
    if (shape.kind === "list" && index !== null && index < this.limits.maxCollectionItems) {
      this.sink.write(id, index, this.encode(own.value), loc);
      return;
    }
    if ((shape.kind === "record" || shape.kind === "instance") && index === null) {
      this.sink.write(id, String(key), this.encode(own.value), loc);
      return;
    }
    this.recapture(object, { l: loc, op: "write" });
  }

  private register(value: JsObject): HeapId {
    const id = this.nextId++;
    this.ids.set(value, id);
    return id;
  }

  private captureNew(roots: JsObject[]): HeapId {
    const first = roots[0]!;
    const id = this.register(first);
    const pending: JsObject[] = [];
    this.sink.heap(this.snapshot(first, id, pending));
    this.drain(pending);
    return id;
  }

  /** Captures newly discovered objects breadth-first, within the per-pass budget. */
  private drain(pending: JsObject[]): void {
    let budget = this.limits.maxObjectsPerCapture;
    for (let i = 0; i < pending.length; i++) {
      const value = pending[i]!;
      const id = this.ids.get(value)!;
      if (budget-- <= 0) {
        this.deferred.add(value);
        this.sink.heap({
          id,
          kind: "opaque",
          typeName: typeNameOf(value),
          summary: "not captured yet",
        });
        continue;
      }
      this.sink.heap(this.snapshot(value, id, pending));
    }
  }

  /** Shallow snapshot; unseen children are registered and queued. */
  private snapshot(value: JsObject, id: HeapId, pending: JsObject[]): HeapObject {
    const child = (v: unknown): EncodedValue => {
      if (!isObjectLike(v)) return encodePrimitive(v, this.limits.maxStringLength);
      let childId = this.ids.get(v);
      if (childId === undefined) {
        childId = this.register(v);
        pending.push(v);
      }
      return ref(childId);
    };
    const max = this.limits.maxCollectionItems;
    const typeName = typeNameOf(value);
    const shape = shapeOf(value);

    switch (shape.kind) {
      case "callable":
        return { id, kind: "callable", typeName, name: functionName(value) };
      case "opaque":
        return { id, kind: "opaque", typeName, summary: shape.summary };
      case "list": {
        const length = shape.items.length;
        const items: EncodedValue[] = [];
        for (let i = 0; i < Math.min(length, max); i++) {
          const own = readOwnData(value, i);
          items.push(own.found ? child(own.value) : primitive("other", "empty"));
        }
        return withOmitted({ id, kind: "list", typeName, items }, length - items.length);
      }
      case "map": {
        const entries = mapEntries(shape.map, max).map(
          ([k, v]) => [child(k), child(v)] as [EncodedValue, EncodedValue],
        );
        return withOmitted(
          { id, kind: "map", typeName, entries },
          collectionSize(shape.map) - entries.length,
        );
      }
      case "set": {
        const items = setValues(shape.set, max).map(child);
        return withOmitted(
          { id, kind: "set", typeName, items },
          collectionSize(shape.set) - items.length,
        );
      }
      case "record":
      case "instance": {
        const all = ownFields(value);
        const fields = all
          .slice(0, max)
          .map(
            ([key, d]) =>
              [key, "value" in d ? child(d.value) : NOT_CAPTURED] as [string, EncodedValue],
          );
        return withOmitted({ id, kind: shape.kind, typeName, fields }, all.length - fields.length);
      }
    }
  }
}

const withOmitted = <T extends HeapObject>(object: T, omitted: number): T => {
  if (omitted > 0) object.omitted = omitted;
  return object;
};
