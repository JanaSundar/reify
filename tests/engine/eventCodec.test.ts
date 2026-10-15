import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeEvents, encodeEvents } from "@/engine/core/protocol/eventCodec";
import { EventKind, type TraceEvent } from "@/engine/core/protocol/events";
import type { EncodedValue, HeapObject, PrimitiveType } from "@/engine/core/protocol/values";
import { CORPUS, TYPESCRIPT_CORPUS } from "../corpus/programs";
import { trace } from "../helpers";

const roundTrip = (events: readonly TraceEvent[]): TraceEvent[] =>
  decodeEvents(encodeEvents(events));

// ---------------------------------------------------------------- generators

/** Ids as the compiler and tracer produce them, plus the NO_LOC sentinel. */
const id = fc.integer({ min: -1, max: 2 ** 31 - 1 });
/** Includes lone surrogates and other ill-formed UTF-16. */
const text = fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.constantFrom("", "1", "x"));
/** Any double, including -0, NaN, infinities and non-int32 integers. */
const number = fc.oneof(fc.integer(), fc.double(), fc.integer({ min: 0, max: 2 ** 32 - 2 }));

const primitiveType = fc.constantFrom<PrimitiveType>(
  "number",
  "string",
  "boolean",
  "null",
  "undefined",
  "bigint",
  "symbol",
  "other",
);

const value: fc.Arbitrary<EncodedValue> = fc.oneof(
  fc.record({ kind: fc.constant("primitive" as const), type: primitiveType, text }),
  fc.record({ kind: fc.constant("ref" as const), id }),
);

const heapBase = {
  id,
  typeName: fc.oneof(text, fc.constantFrom("Array", "Object", "Map", "ListNode")),
  omitted: fc.nat(),
};

const heapObject: fc.Arbitrary<HeapObject> = fc.oneof(
  fc.record(
    { kind: fc.constantFrom("list" as const, "set" as const), ...heapBase, items: fc.array(value) },
    { requiredKeys: ["kind", "id", "typeName", "items"] },
  ),
  fc.record(
    {
      kind: fc.constantFrom("record" as const, "instance" as const),
      ...heapBase,
      fields: fc.array(fc.tuple(text, value)),
    },
    { requiredKeys: ["kind", "id", "typeName", "fields"] },
  ),
  fc.record(
    { kind: fc.constant("map" as const), ...heapBase, entries: fc.array(fc.tuple(value, value)) },
    { requiredKeys: ["kind", "id", "typeName", "entries"] },
  ),
  fc.record(
    { kind: fc.constant("callable" as const), ...heapBase, name: text },
    { requiredKeys: ["kind", "id", "typeName", "name"] },
  ),
  fc.record(
    { kind: fc.constant("opaque" as const), ...heapBase, summary: text },
    { requiredKeys: ["kind", "id", "typeName", "summary"] },
  ),
);

const event: fc.Arbitrary<TraceEvent> = fc.oneof(
  fc.record({ k: fc.constant(EventKind.Line), l: id }),
  fc.record({
    k: fc.constant(EventKind.Call),
    l: id,
    frame: id,
    name: text,
    params: fc.array(fc.tuple(id, value)),
  }),
  fc.record({ k: fc.constant(EventKind.Return), l: id, frame: id, value, threw: fc.boolean() }),
  fc.record({ k: fc.constantFrom(EventKind.Declare, EventKind.Assign), l: id, b: id, v: value }),
  fc.record({
    k: fc.constant(EventKind.Write),
    l: id,
    id,
    key: fc.oneof(number, text),
    v: value,
  }),
  fc.record(
    { k: fc.constant(EventKind.Heap), o: heapObject, via: fc.record({ l: id, op: text }) },
    { requiredKeys: ["k", "o"] },
  ),
  fc.record({ k: fc.constant(EventKind.Branch), l: id, taken: fc.boolean() }),
  fc.record({ k: fc.constant(EventKind.Drop), b: fc.array(id) }),
  fc.record({
    k: fc.constant(EventKind.Console),
    l: id,
    level: fc.constantFrom("log" as const, "info" as const, "warn" as const, "error" as const),
    text,
  }),
  fc.record({ k: fc.constant(EventKind.Throw), l: id, v: value, message: text }),
);

// ---------------------------------------------------------------- properties

describe("event codec", () => {
  it("round-trips arbitrary event batches exactly", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 60 }), (events) => {
        // Same result as the structured clone it replaces (fast-check records have no prototype).
        expect(roundTrip(events)).toStrictEqual(structuredClone(events));
      }),
      { numRuns: 500 },
    );
  });

  it("deduplicates strings and transfers only words", () => {
    const v: EncodedValue = { kind: "primitive", type: "number", text: "42" };
    const events: TraceEvent[] = Array.from({ length: 100 }, (_, i) => ({
      k: EventKind.Assign,
      l: i,
      b: 0,
      v,
    }));
    const batch = encodeEvents(events);
    expect(batch.strings).toEqual(["42"]);
    expect(batch.buffer.byteLength).toBe((2 + 100 * 5) * 4);
    expect(decodeEvents(batch)).toStrictEqual(events);
  });

  for (const [name, source] of Object.entries({ ...CORPUS, ...TYPESCRIPT_CORPUS })) {
    it(`round-trips the real trace of ${name}`, () => {
      const { events } = trace(source, { typescript: name in TYPESCRIPT_CORPUS });
      expect(roundTrip(events)).toStrictEqual(events);
    });
  }

  it("rejects malformed batches with a RangeError instead of returning garbage", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -2, max: 20 }), { maxLength: 40 }), (words) => {
        const batch = { buffer: new Int32Array([1, ...words]).buffer, strings: ["a"] };
        const outcome = (() => {
          try {
            decodeEvents(batch);
            return "decoded";
          } catch (error) {
            return error instanceof RangeError ? "rejected" : error;
          }
        })();
        expect(["decoded", "rejected"]).toContain(outcome);
      }),
      { numRuns: 2000 },
    );
  });

  it("rejects truncated batches", () => {
    fc.assert(
      fc.property(fc.array(event, { minLength: 1, maxLength: 10 }), (events) => {
        const { buffer, strings } = encodeEvents(events);
        const cut = buffer.slice(0, buffer.byteLength - 4);
        expect(() => decodeEvents({ buffer: cut, strings })).toThrow(RangeError);
      }),
    );
  });
});
