import { EventKind, type ConsoleLevel, type TraceEvent } from "../../../core/protocol/events";
import {
  primitive,
  ref,
  type EncodedValue,
  type HeapObject,
  type PrimitiveType,
} from "../../../core/protocol/values";

/**
 * Decodes the Python tracer's event batches (`reify_tracer.py`) into protocol events.
 *
 * A batch is a JSON array of positional events whose first element is the `EventKind`.
 * Values are a heap id (a number) or `[primitiveType, text]`. Heap objects arrive in their
 * protocol shape, with values encoded the same way.
 */

type WireValue = number | [PrimitiveType, string];

type WireHeapObject =
  | { id: number; kind: "list" | "set"; typeName: string; items: WireValue[]; omitted?: number }
  | {
      id: number;
      kind: "map";
      typeName: string;
      entries: [WireValue, WireValue][];
      omitted?: number;
    }
  | {
      id: number;
      kind: "record" | "instance";
      typeName: string;
      fields: [string, WireValue][];
      omitted?: number;
    }
  | { id: number; kind: "callable"; typeName: string; name: string }
  | { id: number; kind: "opaque"; typeName: string; summary: string };

type WireEvent = [number, ...unknown[]];

const value = (wire: WireValue): EncodedValue =>
  typeof wire === "number" ? ref(wire) : primitive(wire[0], wire[1]);

const heapObject = (wire: WireHeapObject): HeapObject => {
  switch (wire.kind) {
    case "list":
    case "set":
      return { ...wire, items: wire.items.map(value) };
    case "map":
      return { ...wire, entries: wire.entries.map(([k, v]) => [value(k), value(v)]) };
    case "record":
    case "instance":
      return { ...wire, fields: wire.fields.map(([name, v]) => [name, value(v)]) };
    case "callable":
    case "opaque":
      return wire;
  }
};

const decodeEvent = (event: WireEvent): TraceEvent => {
  const [kind] = event;
  const l = event[1] as number;
  switch (kind) {
    case EventKind.Line:
      return { k: EventKind.Line, l };
    case EventKind.Call:
      return {
        k: EventKind.Call,
        l,
        frame: event[2] as number,
        name: event[3] as string,
        params: (event[4] as [number, WireValue][]).map(([b, v]) => [b, value(v)]),
      };
    case EventKind.Return:
      return {
        k: EventKind.Return,
        l,
        frame: event[2] as number,
        value: value(event[3] as WireValue),
        threw: event[4] === 1,
      };
    case EventKind.Declare:
    case EventKind.Assign:
      return { k: kind, l, b: event[2] as number, v: value(event[3] as WireValue) };
    case EventKind.Write:
      return {
        k: EventKind.Write,
        l,
        id: event[2] as number,
        key: event[3] as number | string,
        v: value(event[4] as WireValue),
      };
    case EventKind.Heap: {
      const o = heapObject(event[1] as WireHeapObject);
      return event.length > 2
        ? { k: EventKind.Heap, o, via: { l: event[2] as number, op: event[3] as string } }
        : { k: EventKind.Heap, o };
    }
    case EventKind.Branch:
      return { k: EventKind.Branch, l, taken: event[2] === 1 };
    case EventKind.Drop:
      return { k: EventKind.Drop, b: event[1] as number[] };
    case EventKind.Console:
      return { k: EventKind.Console, l, level: event[2] as ConsoleLevel, text: event[3] as string };
    case EventKind.Throw:
      return {
        k: EventKind.Throw,
        l,
        v: value(event[2] as WireValue),
        message: event[3] as string,
      };
    default:
      throw new Error(`Unknown Python trace event kind ${kind}`);
  }
};

export const decodePythonEvents = (batch: string): TraceEvent[] =>
  (JSON.parse(batch) as WireEvent[]).map(decodeEvent);
