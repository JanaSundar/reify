import {
  capturedCount,
  entryCount,
  type EncodedValue,
  type HeapId,
  type HeapObject,
} from "../protocol/values";

type Heap = ReadonlyMap<HeapId, HeapObject>;

/** Where a location is, for sentences: `line 3`, or `utils/math.js line 3` in a multi-file run. */
export const placeOf = (
  program: { readonly files: readonly { readonly path: string }[] },
  loc: { readonly file: number; readonly line: number },
): string =>
  program.files.length > 1
    ? `${program.files[loc.file]?.path} line ${loc.line}`
    : `line ${loc.line}`;

const MAX_PREVIEW_ITEMS = 6;

const more = (object: HeapObject): string =>
  capturedCount(object) > MAX_PREVIEW_ITEMS || object.omitted ? ", …" : "";

/** Type name with the collection's runtime size, e.g. `Map(2)`, `Array(3)`. */
export const sizedTypeName = (object: HeapObject): string =>
  `${object.typeName}(${entryCount(object)})`;

/**
 * Short, single-line description of a value, e.g. `[1, 2, 3]`, `Map(2)`, `ListNode#4`.
 * Pure; shared by explanations and compact UI labels.
 */
export const previewValue = (value: EncodedValue, heap: Heap, depth = 0): string => {
  if (value.kind === "primitive") return value.text;
  const object = heap.get(value.id);
  if (!object) return `#${value.id}`;
  const nested = (v: EncodedValue): string =>
    depth >= 1 ? shallow(v, heap) : previewValue(v, heap, depth + 1);

  switch (object.kind) {
    case "list":
      return `[${object.items.slice(0, MAX_PREVIEW_ITEMS).map(nested).join(", ")}${more(object)}]`;
    case "set":
      return `${sizedTypeName(object)} {${object.items.slice(0, MAX_PREVIEW_ITEMS).map(nested).join(", ")}${more(object)}}`;
    case "map":
      return `${sizedTypeName(object)} {${object.entries
        .slice(0, MAX_PREVIEW_ITEMS)
        .map(([k, v]) => `${nested(k)} => ${nested(v)}`)
        .join(", ")}${more(object)}}`;
    case "record":
    case "instance": {
      const prefix = object.kind === "instance" ? `${object.typeName} ` : "";
      if (depth >= 1) return `${prefix}{…}`;
      return `${prefix}{${object.fields
        .slice(0, MAX_PREVIEW_ITEMS)
        .map(([k, v]) => `${k}: ${nested(v)}`)
        .join(", ")}${more(object)}}`;
    }
    case "callable":
      return `ƒ ${object.name}`;
    case "opaque":
      return object.summary;
  }
};

const shallow = (value: EncodedValue, heap: Heap): string => {
  if (value.kind === "primitive") return value.text;
  const object = heap.get(value.id);
  if (!object) return `#${value.id}`;
  switch (object.kind) {
    case "list":
      return `[…${object.items.length}]`;
    case "callable":
      return `ƒ ${object.name}`;
    case "opaque":
      return object.summary;
    default:
      return `${object.typeName}#${object.id}`;
  }
};
