import { EventKind, type ConsoleLevel, type TraceEvent } from "./events";
import type { EncodedValue, HeapKind, HeapObject, PrimitiveType, PrimitiveValue } from "./values";

/**
 * Compact binary encoding of event batches for the worker → main thread hop.
 *
 * A batch is a stream of 32-bit words (sent as a transferable `ArrayBuffer`, so it moves
 * without copying) plus a table of the distinct strings it references. Strings stay plain
 * JS strings: deduplicated per batch they are few, and structured clone copies them exactly
 * (including lone surrogates, which UTF-8 or UTF-16 text codecs would replace).
 *
 * Word layout: `[FORMAT_VERSION, eventCount, ...events]`, each event being its kind followed
 * by kind-specific fields (see `writeEvent`). Decoding validates every read, so a malformed
 * batch throws instead of producing garbage.
 */
export interface EncodedEvents {
  readonly buffer: ArrayBuffer;
  readonly strings: readonly string[];
}

const FORMAT_VERSION = 1;

const PRIMITIVE_TYPES: readonly PrimitiveType[] = [
  "number",
  "string",
  "boolean",
  "null",
  "undefined",
  "bigint",
  "symbol",
  "other",
];
/** Value tag for refs; primitive values use their index in `PRIMITIVE_TYPES` as tag. */
const REF_TAG = PRIMITIVE_TYPES.length;

const HEAP_KINDS: readonly HeapKind[] = [
  "list",
  "record",
  "instance",
  "map",
  "set",
  "callable",
  "opaque",
];
const CONSOLE_LEVELS: readonly ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

/** Tags of optional numbers and of `number | string` slot keys. */
const Scalar = { Absent: 0, Int: 1, Float: 2, String: 3 } as const;

const indexes = <T extends string>(values: readonly T[]): ReadonlyMap<T, number> =>
  new Map(values.map((value, index) => [value, index]));

const PRIMITIVE_TAG = indexes(PRIMITIVE_TYPES);
const HEAP_KIND_TAG = indexes(HEAP_KINDS);
const CONSOLE_LEVEL_TAG = indexes(CONSOLE_LEVELS);

// Reinterprets doubles as two words; both ends share the host's byte order.
const floatScratch = new Float64Array(1);
const floatWords = new Int32Array(floatScratch.buffer);

const isInt32 = (value: number): boolean => (value | 0) === value && !Object.is(value, -0);

const tagOf = <T>(table: ReadonlyMap<T, number>, value: T): number => {
  const tag = table.get(value);
  if (tag === undefined) throw new TypeError(`Cannot encode ${String(value)}`);
  return tag;
};

class WordWriter {
  private words: Int32Array<ArrayBuffer>;
  private length = 0;
  private readonly strings: string[] = [];
  private readonly stringIndex = new Map<string, number>();

  constructor(capacity: number) {
    this.words = new Int32Array(Math.max(16, capacity));
  }

  int(value: number): void {
    if (this.length === this.words.length) {
      const grown = new Int32Array(this.words.length * 2);
      grown.set(this.words);
      this.words = grown;
    }
    this.words[this.length++] = value;
  }

  bool(value: boolean): void {
    this.int(value ? 1 : 0);
  }

  string(value: string): void {
    let index = this.stringIndex.get(value);
    if (index === undefined) {
      index = this.strings.push(value) - 1;
      this.stringIndex.set(value, index);
    }
    this.int(index);
  }

  scalar(value: number | string | undefined): void {
    if (value === undefined) {
      this.int(Scalar.Absent);
    } else if (typeof value === "string") {
      this.int(Scalar.String);
      this.string(value);
    } else if (isInt32(value)) {
      this.int(Scalar.Int);
      this.int(value);
    } else {
      floatScratch[0] = value;
      this.int(Scalar.Float);
      this.int(floatWords[0]!);
      this.int(floatWords[1]!);
    }
  }

  value(value: EncodedValue): void {
    if (value.kind === "ref") {
      this.int(REF_TAG);
      this.int(value.id);
    } else {
      this.int(tagOf(PRIMITIVE_TAG, value.type));
      this.string(value.text);
    }
  }

  finish(): EncodedEvents {
    return { buffer: this.words.buffer.slice(0, this.length * 4), strings: this.strings };
  }
}

class WordReader {
  private position = 0;
  /** Decoded primitives are immutable, so equal ones share one object per batch. */
  private readonly primitives: PrimitiveValue[] = [];

  constructor(
    private readonly words: Int32Array,
    private readonly strings: readonly string[],
  ) {}

  get done(): boolean {
    return this.position === this.words.length;
  }

  int(): number {
    if (this.position >= this.words.length) throw new RangeError("Truncated event batch");
    return this.words[this.position++]!;
  }

  count(): number {
    const count = this.int();
    if (count < 0 || count > this.words.length - this.position) {
      throw new RangeError(`Invalid count ${count} in event batch`);
    }
    return count;
  }

  bool(): boolean {
    return this.int() !== 0;
  }

  string(): string {
    const value = this.strings[this.int()];
    if (typeof value !== "string") throw new RangeError("Invalid string index in event batch");
    return value;
  }

  tagged<T>(table: readonly T[], what: string): T {
    const value = table[this.int()];
    if (value === undefined) throw new RangeError(`Invalid ${what} in event batch`);
    return value;
  }

  scalar(): number | string | undefined {
    const tag = this.int();
    switch (tag) {
      case Scalar.Absent:
        return undefined;
      case Scalar.String:
        return this.string();
      case Scalar.Int:
        return this.int();
      case Scalar.Float:
        floatWords[0] = this.int();
        floatWords[1] = this.int();
        return floatScratch[0]!;
      default:
        throw new RangeError(`Invalid scalar tag ${tag} in event batch`);
    }
  }

  number(): number {
    const value = this.scalar();
    if (typeof value !== "number") throw new RangeError("Expected a number in event batch");
    return value;
  }

  value(): EncodedValue {
    const tag = this.int();
    if (tag === REF_TAG) return { kind: "ref", id: this.int() };
    const type = PRIMITIVE_TYPES[tag];
    if (type === undefined) throw new RangeError(`Invalid value tag ${tag} in event batch`);
    const textIndex = this.words[this.position] ?? -1;
    const key = textIndex * REF_TAG + tag;
    const cached = textIndex >= 0 ? this.primitives[key] : undefined;
    if (cached) {
      this.position++;
      return cached;
    }
    const value: PrimitiveValue = { kind: "primitive", type, text: this.string() };
    this.primitives[key] = value;
    return value;
  }

  values(): EncodedValue[] {
    const items: EncodedValue[] = Array.from({ length: this.count() });
    for (let i = 0; i < items.length; i++) items[i] = this.value();
    return items;
  }
}

// ---------------------------------------------------------------- heap objects

const writeHeapObject = (w: WordWriter, object: HeapObject): void => {
  w.int(tagOf(HEAP_KIND_TAG, object.kind));
  w.int(object.id);
  w.string(object.typeName);
  w.scalar(object.omitted);
  switch (object.kind) {
    case "list":
    case "set":
      w.int(object.items.length);
      for (const item of object.items) w.value(item);
      return;
    case "record":
    case "instance":
      w.int(object.fields.length);
      for (const [name, value] of object.fields) {
        w.string(name);
        w.value(value);
      }
      return;
    case "map":
      w.int(object.entries.length);
      for (const [key, value] of object.entries) {
        w.value(key);
        w.value(value);
      }
      return;
    case "callable":
      w.string(object.name);
      return;
    case "opaque":
      w.string(object.summary);
      return;
  }
};

const readHeapBody = (r: WordReader, kind: HeapKind, id: number, typeName: string): HeapObject => {
  switch (kind) {
    case "list":
    case "set":
      return { kind, id, typeName, items: r.values() };
    case "record":
    case "instance": {
      const fields: Array<[string, EncodedValue]> = Array.from({ length: r.count() });
      for (let i = 0; i < fields.length; i++) fields[i] = [r.string(), r.value()];
      return { kind, id, typeName, fields };
    }
    case "map": {
      const entries: Array<[EncodedValue, EncodedValue]> = Array.from({ length: r.count() });
      for (let i = 0; i < entries.length; i++) entries[i] = [r.value(), r.value()];
      return { kind, id, typeName, entries };
    }
    case "callable":
      return { kind, id, typeName, name: r.string() };
    case "opaque":
      return { kind, id, typeName, summary: r.string() };
  }
};

const readHeapObject = (r: WordReader): HeapObject => {
  const kind = r.tagged(HEAP_KINDS, "heap kind");
  const id = r.int();
  const typeName = r.string();
  const omitted = r.scalar();
  if (omitted !== undefined && typeof omitted !== "number") {
    throw new RangeError("Invalid omitted count in event batch");
  }
  const object = readHeapBody(r, kind, id, typeName);
  if (omitted !== undefined) object.omitted = omitted;
  return object;
};

// ---------------------------------------------------------------- events

const writeEvent = (w: WordWriter, event: TraceEvent): void => {
  w.int(event.k);
  switch (event.k) {
    case EventKind.Line:
      w.int(event.l);
      return;
    case EventKind.Call:
      w.int(event.l);
      w.int(event.frame);
      w.string(event.name);
      w.int(event.params.length);
      for (const [binding, value] of event.params) {
        w.int(binding);
        w.value(value);
      }
      return;
    case EventKind.Return:
      w.int(event.l);
      w.int(event.frame);
      w.value(event.value);
      w.bool(event.threw);
      return;
    case EventKind.Declare:
    case EventKind.Assign:
      w.int(event.l);
      w.int(event.b);
      w.value(event.v);
      return;
    case EventKind.Write:
      w.int(event.l);
      w.int(event.id);
      w.scalar(event.key);
      w.value(event.v);
      return;
    case EventKind.Heap:
      if (event.via) {
        w.bool(true);
        w.int(event.via.l);
        w.string(event.via.op);
      } else {
        w.bool(false);
      }
      writeHeapObject(w, event.o);
      return;
    case EventKind.Branch:
      w.int(event.l);
      w.bool(event.taken);
      return;
    case EventKind.Drop:
      w.int(event.b.length);
      for (const binding of event.b) w.int(binding);
      return;
    case EventKind.Console:
      w.int(event.l);
      w.int(tagOf(CONSOLE_LEVEL_TAG, event.level));
      w.string(event.text);
      return;
    case EventKind.Throw:
      w.int(event.l);
      w.value(event.v);
      w.string(event.message);
      return;
  }
};

const readEvent = (r: WordReader): TraceEvent => {
  const k = r.int();
  switch (k) {
    case EventKind.Line:
      return { k, l: r.int() };
    case EventKind.Call: {
      const l = r.int();
      const frame = r.int();
      const name = r.string();
      const params: Array<readonly [number, EncodedValue]> = Array.from({ length: r.count() });
      for (let i = 0; i < params.length; i++) params[i] = [r.int(), r.value()];
      return { k, l, frame, name, params };
    }
    case EventKind.Return:
      return { k, l: r.int(), frame: r.int(), value: r.value(), threw: r.bool() };
    case EventKind.Declare:
    case EventKind.Assign:
      return { k, l: r.int(), b: r.int(), v: r.value() };
    case EventKind.Write: {
      const l = r.int();
      const id = r.int();
      const key = r.scalar();
      if (key === undefined) throw new RangeError("Missing slot key in event batch");
      return { k, l, id, key, v: r.value() };
    }
    case EventKind.Heap: {
      if (!r.bool()) return { k, o: readHeapObject(r) };
      const via = { l: r.int(), op: r.string() };
      return { k, o: readHeapObject(r), via };
    }
    case EventKind.Branch:
      return { k, l: r.int(), taken: r.bool() };
    case EventKind.Drop: {
      const b: number[] = Array.from({ length: r.count() });
      for (let i = 0; i < b.length; i++) b[i] = r.int();
      return { k, b };
    }
    case EventKind.Console:
      return { k, l: r.int(), level: r.tagged(CONSOLE_LEVELS, "console level"), text: r.string() };
    case EventKind.Throw:
      return { k, l: r.int(), v: r.value(), message: r.string() };
    default:
      throw new RangeError(`Invalid event kind ${k} in event batch`);
  }
};

/** Encodes a batch of events. The result's buffer is meant to be transferred, not copied. */
export const encodeEvents = (events: readonly TraceEvent[]): EncodedEvents => {
  const w = new WordWriter(2 + events.length * 6);
  w.int(FORMAT_VERSION);
  w.int(events.length);
  for (const event of events) writeEvent(w, event);
  return w.finish();
};

/** Decodes a batch produced by {@link encodeEvents}; throws on malformed input. */
export const decodeEvents = (batch: EncodedEvents): TraceEvent[] => {
  const { buffer, strings } = batch;
  if (buffer.byteLength % 4 !== 0) throw new RangeError("Misaligned event batch");
  const r = new WordReader(new Int32Array(buffer), strings);
  const version = r.int();
  if (version !== FORMAT_VERSION) throw new RangeError(`Unsupported event batch v${version}`);
  const events: TraceEvent[] = Array.from({ length: r.count() });
  for (let i = 0; i < events.length; i++) events[i] = readEvent(r);
  if (!r.done) throw new RangeError("Trailing data in event batch");
  return events;
};
