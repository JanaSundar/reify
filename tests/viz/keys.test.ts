import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { primitive, ref, type EncodedValue } from "@/engine/core/protocol/values";
import { initialKeys, reconcileKeys } from "@/features/viz/keys";

const nums = (...values: number[]): EncodedValue[] =>
  values.map((n) => primitive("number", String(n)));

/** Key of each value after moving from `before` to `after`, as value → key. */
const step = (before: EncodedValue[], after: EncodedValue[]) => {
  const first = initialKeys(before);
  const second = reconcileKeys(first, after);
  return { first: first.keys, second: second.keys };
};

describe("reconcileKeys", () => {
  it("keeps keys of existing cells when pushing and shifting", () => {
    const pushed = step(nums(1, 2, 3), nums(1, 2, 3, 4));
    expect(pushed.second.slice(0, 3)).toEqual(pushed.first);
    expect(pushed.first).not.toContain(pushed.second[3]);

    const shifted = step(nums(1, 2, 3), nums(2, 3));
    expect(shifted.second).toEqual(shifted.first.slice(1));
  });

  it("keeps the surrounding cells' keys around a splice", () => {
    const { first, second } = step(nums(1, 2, 3, 4), nums(1, 9, 9, 4));
    expect(second).toEqual(first);
    const removed = step(nums(1, 2, 3, 4, 5), nums(1, 2, 4, 5));
    expect(removed.second).toEqual([
      removed.first[0],
      removed.first[1],
      removed.first[3],
      removed.first[4],
    ]);
    const inserted = step(nums(1, 2, 3), nums(1, 7, 2, 3));
    expect(inserted.second[0]).toBe(inserted.first[0]);
    expect(inserted.second.slice(2)).toEqual(inserted.first.slice(1));
  });

  it("moves cells with their values when the list is reordered", () => {
    const { first, second } = step(nums(3, 1, 2), nums(1, 2, 3));
    expect(second).toEqual([first[1], first[2], first[0]]);
  });

  it("keeps cells in place for slot writes, even mid-swap with duplicates", () => {
    const { first, second } = step(nums(5, 3), nums(3, 3));
    expect(second).toEqual(first);
  });

  it("matches heap objects by identity", () => {
    const { first, second } = step([ref(1), ref(2)], [ref(2), ref(3), ref(1)]);
    expect(second[0]).toBe(first[1]);
    expect(second[2]).toBe(first[0]);
  });

  it("always produces one unique key per cell", () => {
    const list = fc
      .array(fc.integer({ min: 0, max: 4 }), { maxLength: 12 })
      .map((xs) => nums(...xs));
    fc.assert(
      fc.property(fc.array(list, { minLength: 1, maxLength: 6 }), (lists) => {
        let keys = initialKeys(lists[0]!);
        for (const values of lists) {
          keys = reconcileKeys(keys, values);
          expect(keys.keys).toHaveLength(values.length);
          expect(new Set(keys.keys).size).toBe(values.length);
        }
      }),
    );
  });
});
