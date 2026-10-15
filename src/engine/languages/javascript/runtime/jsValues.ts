import { primitive, type HeapKind, type PrimitiveValue } from "../../../core/protocol/values";

/**
 * Intrinsics captured when this module loads, before any user code runs, so that user code
 * that patches prototypes cannot change how values are inspected.
 */
const { getPrototypeOf, getOwnPropertyDescriptor, keys: objectKeys } = Object;
const { isArray } = Array;
const { apply } = Reflect;
const { isView } = ArrayBuffer;
const mapSize = getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const setSize = getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const functionToString = Function.prototype.toString;
const dateToISOString = Date.prototype.toISOString;
const dateGetTime = Date.prototype.getTime;
const regExpToString = RegExp.prototype.toString;
const symbolToString = Symbol.prototype.toString;
const ObjectPrototype = Object.prototype;
const DataViewCtor = DataView;
const ErrorCtor = Error;
const DateCtor = Date;
const RegExpCtor = RegExp;
const stringify = JSON.stringify;

export type JsObject = object;

export const isObjectLike = (value: unknown): value is JsObject =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const brandCheck = (getter: () => unknown, value: JsObject): boolean => {
  try {
    apply(getter, value, []);
    return true;
  } catch {
    return false;
  }
};

export const isMap = (value: JsObject): value is Map<unknown, unknown> =>
  brandCheck(mapSize, value);
export const isSet = (value: JsObject): value is Set<unknown> => brandCheck(setSize, value);
const isTypedArray = (value: JsObject): value is ArrayLike<unknown> =>
  isView(value) && !(value instanceof DataViewCtor);

export type JsShape =
  | { readonly kind: "list"; readonly items: ArrayLike<unknown> }
  | { readonly kind: "map"; readonly map: Map<unknown, unknown> }
  | { readonly kind: "set"; readonly set: Set<unknown> }
  | { readonly kind: "callable" }
  | { readonly kind: "opaque"; readonly summary: string }
  | { readonly kind: "record" | "instance" };

/** Classifies an object into a language-neutral heap kind without running user code. */
export const shapeOf = (value: JsObject): JsShape => {
  if (typeof value === "function") return { kind: "callable" };
  if (isArray(value)) return { kind: "list", items: value as unknown[] };
  if (isTypedArray(value)) return { kind: "list", items: value };
  if (isMap(value)) return { kind: "map", map: value };
  if (isSet(value)) return { kind: "set", set: value };
  if (value instanceof DateCtor) {
    const time = apply(dateGetTime, value, []) as number;
    return {
      kind: "opaque",
      summary: Number.isNaN(time) ? "Invalid Date" : (apply(dateToISOString, value, []) as string),
    };
  }
  if (value instanceof RegExpCtor)
    return { kind: "opaque", summary: apply(regExpToString, value, []) as string };
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
    return { kind: "opaque", summary: typeNameOf(value) };
  }
  const proto: unknown = getPrototypeOf(value);
  return { kind: proto === ObjectPrototype || proto === null ? "record" : "instance" };
};

export const heapKindOf = (value: JsObject): HeapKind => shapeOf(value).kind;

/** Constructor name from a data property only (no getters are invoked). */
export const typeNameOf = (value: JsObject): string => {
  if (typeof value === "function") {
    const source = safeFunctionSource(value);
    return source.startsWith("class") ? "Class" : "Function";
  }
  if (isArray(value)) return "Array";
  const proto: unknown = getPrototypeOf(value);
  if (proto === null) return "Object";
  const descriptor = getOwnPropertyDescriptor(proto, "constructor");
  const ctor: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof ctor === "function") {
    const name = getOwnPropertyDescriptor(ctor, "name")?.value;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return "Object";
};

const safeFunctionSource = (fn: JsObject): string => {
  try {
    return apply(functionToString, fn, []) as string;
  } catch {
    return "";
  }
};

export const functionName = (fn: JsObject): string => {
  const name = getOwnPropertyDescriptor(fn, "name")?.value;
  return typeof name === "string" && name.length > 0 ? name : "(anonymous)";
};

export const isErrorObject = (value: unknown): value is Error => value instanceof ErrorCtor;

/** Own enumerable string-keyed properties, read through descriptors (getters not run). */
export const ownFields = (value: JsObject): Array<[string, PropertyDescriptor]> => {
  const fields: Array<[string, PropertyDescriptor]> = [];
  for (const key of objectKeys(value)) {
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (descriptor) fields.push([key, descriptor]);
  }
  // Error messages are own but non-enumerable.
  if (isErrorObject(value)) {
    const message = getOwnPropertyDescriptor(value, "message");
    if (message && !fields.some(([key]) => key === "message")) fields.unshift(["message", message]);
  }
  return fields;
};

export const readOwnData = (
  value: JsObject,
  key: PropertyKey,
): { found: boolean; value?: unknown } => {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false };
};

export const mapEntries = (
  map: Map<unknown, unknown>,
  limit: number,
): Array<[unknown, unknown]> => {
  const out: Array<[unknown, unknown]> = [];
  apply(mapForEach, map, [
    (value: unknown, key: unknown) => {
      if (out.length < limit) out.push([key, value]);
    },
  ]);
  return out;
};

export const setValues = (set: Set<unknown>, limit: number): unknown[] => {
  const out: unknown[] = [];
  apply(setForEach, set, [
    (value: unknown) => {
      if (out.length < limit) out.push(value);
    },
  ]);
  return out;
};

export const collectionSize = (value: Map<unknown, unknown> | Set<unknown>): number =>
  apply(isMap(value) ? mapSize : setSize, value, []) as number;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Display text of a primitive; strings are quoted (JSON style). */
export const encodePrimitive = (value: unknown, maxLength: number): PrimitiveValue => {
  switch (typeof value) {
    case "number":
      return primitive("number", Object.is(value, -0) ? "-0" : String(value));
    case "string":
      return primitive("string", truncate(stringify(value), maxLength));
    case "boolean":
      return primitive("boolean", String(value));
    case "undefined":
      return primitive("undefined", "undefined");
    case "bigint":
      return primitive("bigint", `${value}n`);
    case "symbol":
      return primitive("symbol", apply(symbolToString, value, []) as string);
    default:
      return value === null ? primitive("null", "null") : primitive("other", "?");
  }
};

/** Message of a thrown value, e.g. `TypeError: x is not a function`. */
export const describeThrown = (error: unknown): string => {
  if (isErrorObject(error)) {
    const message = readOwnData(error, "message");
    const text = typeof message.value === "string" ? message.value : "";
    const name = typeNameOf(error);
    return text ? `${name}: ${text}` : name;
  }
  return `Uncaught ${formatValue(error, 0, 200)}`;
};

const MAX_FORMAT_DEPTH = 2;
const MAX_FORMAT_ITEMS = 50;

const more = (count: number): string =>
  count > MAX_FORMAT_ITEMS ? `, … ${count - MAX_FORMAT_ITEMS} more` : "";

/**
 * Console-style formatting (pure; never invokes user getters). Used for console output by
 * both instrumented and plain execution, so differential tests compare like with like.
 */
export const formatValue = (
  value: unknown,
  depth: number,
  maxLength: number,
  seen = new Set<JsObject>(),
): string => {
  if (!isObjectLike(value)) {
    if (typeof value === "string") return depth === 0 ? value : `'${value}'`;
    return encodePrimitive(value, maxLength).text;
  }
  if (seen.has(value)) return "[Circular]";
  const shape = shapeOf(value);
  const nested = (v: unknown): string => {
    seen.add(value);
    const text = formatValue(v, depth + 1, maxLength, seen);
    seen.delete(value);
    return text;
  };
  const tooDeep = depth > MAX_FORMAT_DEPTH;

  switch (shape.kind) {
    case "callable":
      return `[${typeNameOf(value)}: ${functionName(value)}]`;
    case "opaque":
      return shape.summary;
    case "list": {
      if (tooDeep) return "[Array]";
      const items: string[] = [];
      for (let i = 0; i < Math.min(shape.items.length, MAX_FORMAT_ITEMS); i++) {
        const own = readOwnData(value, i);
        items.push(own.found ? nested(own.value) : "<empty>");
      }
      return `[${items.join(", ")}${more(shape.items.length)}]`;
    }
    case "map": {
      const size = collectionSize(shape.map);
      if (tooDeep) return `Map(${size})`;
      const entries = mapEntries(shape.map, MAX_FORMAT_ITEMS).map(
        ([k, v]) => `${nested(k)} => ${nested(v)}`,
      );
      return `Map(${size}) {${entries.join(", ")}${more(size)}}`;
    }
    case "set": {
      const size = collectionSize(shape.set);
      if (tooDeep) return `Set(${size})`;
      return `Set(${size}) {${setValues(shape.set, MAX_FORMAT_ITEMS).map(nested).join(", ")}${more(size)}}`;
    }
    case "record":
    case "instance": {
      if (isErrorObject(value)) return describeThrown(value);
      const prefix = shape.kind === "instance" ? `${typeNameOf(value)} ` : "";
      if (tooDeep) return `${prefix}{…}`;
      const fields = ownFields(value).map(
        ([key, d]) => `${key}: ${"value" in d ? nested(d.value) : "[Getter/Setter]"}`,
      );
      return fields.length === 0 ? `${prefix}{}` : `${prefix}{${fields.join(", ")}}`;
    }
  }
};

export const formatConsoleArgs = (args: readonly unknown[], maxLength: number): string =>
  truncate(args.map((arg) => formatValue(arg, 0, maxLength)).join(" "), maxLength * 4);
