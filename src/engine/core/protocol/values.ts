/**
 * Language-neutral encoding of runtime values.
 *
 * Primitive values are inlined with a display string produced by the language adapter.
 * Everything with identity (objects, lists, maps, functions, ...) lives in the heap and is
 * referenced by a stable numeric id, so aliasing and cycles survive serialization.
 */

export type HeapId = number;

export type PrimitiveType =
  | "number"
  | "string"
  | "boolean"
  | "null"
  | "undefined"
  | "bigint"
  | "symbol"
  /** Values that are not ordinary data (array holes, accessors, uncaptured values). */
  | "other";

export interface PrimitiveValue {
  readonly kind: "primitive";
  readonly type: PrimitiveType;
  /** Display text, formatted by the language adapter (e.g. `"abc"`, `3`, `null`). */
  readonly text: string;
}

export interface RefValue {
  readonly kind: "ref";
  readonly id: HeapId;
}

export type EncodedValue = PrimitiveValue | RefValue;

interface HeapObjectBase {
  readonly id: HeapId;
  /** Language-specific type label, e.g. `Array`, `Map`, `ListNode`, `dict`. */
  readonly typeName: string;
  /** Number of entries not captured because of collection size limits. */
  omitted?: number;
}

/** Ordered, index-addressed collection (JS arrays, typed arrays, Python lists, ...). */
export interface ListObject extends HeapObjectBase {
  readonly kind: "list";
  items: EncodedValue[];
}

/** String-keyed fields (plain objects, class instances, errors, ...). */
export interface RecordObject extends HeapObjectBase {
  readonly kind: "record" | "instance";
  fields: Array<[string, EncodedValue]>;
}

export interface MapObject extends HeapObjectBase {
  readonly kind: "map";
  entries: Array<[EncodedValue, EncodedValue]>;
}

export interface SetObject extends HeapObjectBase {
  readonly kind: "set";
  items: EncodedValue[];
}

export interface CallableObject extends HeapObjectBase {
  readonly kind: "callable";
  readonly name: string;
}

/** Values whose internals are not captured (dates, regexps, promises, ...). */
export interface OpaqueObject extends HeapObjectBase {
  readonly kind: "opaque";
  readonly summary: string;
}

export type HeapObject =
  | ListObject
  | RecordObject
  | MapObject
  | SetObject
  | CallableObject
  | OpaqueObject;

export type HeapKind = HeapObject["kind"];

export const primitive = (type: PrimitiveType, text: string): PrimitiveValue => ({
  kind: "primitive",
  type,
  text,
});

export const ref = (id: HeapId): RefValue => ({ kind: "ref", id });

export const UNDEFINED_VALUE: PrimitiveValue = primitive("undefined", "undefined");

export const isRef = (value: EncodedValue): value is RefValue => value.kind === "ref";

/** Entries actually captured: list and set items, map entries or record fields. */
export const capturedCount = (object: HeapObject): number => {
  switch (object.kind) {
    case "list":
    case "set":
      return object.items.length;
    case "map":
      return object.entries.length;
    case "record":
    case "instance":
      return object.fields.length;
    case "callable":
    case "opaque":
      return 0;
  }
};

/** Size of the collection at runtime, including entries not captured because of limits. */
export const entryCount = (object: HeapObject): number =>
  capturedCount(object) + (object.omitted ?? 0);

/** Every value an object holds (map keys included), in order. */
export const childValues = (object: HeapObject): EncodedValue[] => {
  switch (object.kind) {
    case "list":
    case "set":
      return object.items;
    case "map":
      return object.entries.flat();
    case "record":
    case "instance":
      return object.fields.map(([, value]) => value);
    case "callable":
    case "opaque":
      return [];
  }
};

/** Copies a heap object so the copy can be mutated without touching the original. */
export const cloneHeapObject = (object: HeapObject): HeapObject => {
  switch (object.kind) {
    case "list":
    case "set":
      return { ...object, items: object.items.slice() };
    case "record":
    case "instance":
      return { ...object, fields: object.fields.slice() };
    case "map":
      return { ...object, entries: object.entries.slice() };
    case "callable":
    case "opaque":
      return { ...object };
  }
};
