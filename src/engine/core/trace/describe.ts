import type { EncodedValue, HeapId, HeapObject } from "../protocol/values";

type Heap = ReadonlyMap<HeapId, HeapObject>;

const MAX_PREVIEW_ITEMS = 6;

const more = (count: number, omitted = 0): string =>
  count > MAX_PREVIEW_ITEMS || omitted > 0 ? ", …" : "";

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
      return `[${object.items.slice(0, MAX_PREVIEW_ITEMS).map(nested).join(", ")}${more(object.items.length, object.omitted)}]`;
    case "set":
      return `${object.typeName}(${object.items.length + (object.omitted ?? 0)}) {${object.items.slice(0, MAX_PREVIEW_ITEMS).map(nested).join(", ")}${more(object.items.length, object.omitted)}}`;
    case "map":
      return `${object.typeName}(${object.entries.length + (object.omitted ?? 0)}) {${object.entries
        .slice(0, MAX_PREVIEW_ITEMS)
        .map(([k, v]) => `${nested(k)} => ${nested(v)}`)
        .join(", ")}${more(object.entries.length, object.omitted)}}`;
    case "record":
    case "instance": {
      const prefix = object.kind === "instance" ? `${object.typeName} ` : "";
      if (depth >= 1) return `${prefix}{…}`;
      return `${prefix}{${object.fields
        .slice(0, MAX_PREVIEW_ITEMS)
        .map(([k, v]) => `${k}: ${nested(v)}`)
        .join(", ")}${more(object.fields.length, object.omitted)}}`;
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
