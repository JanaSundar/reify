import type { EncodedValue, HeapObject } from "@/engine/core/protocol/values";
import type { HeapChange, HeapMutation, StepView } from "@/engine/core/trace/stepView";
import { valueIdentity } from "./keys";

export type EntryChange = "added" | "updated";

/** What one step did to an object's entries, keyed by entry identity. */
export interface EntryChanges {
  readonly entries: ReadonlyMap<string, EntryChange>;
  /** Keys that existed before the step and are gone now. */
  readonly removed: number;
  /** The object was mutated by an operation that left it exactly as it was. */
  readonly unchanged: boolean;
  /** The mutating operation, when the object was mutated in this step. */
  readonly op: string | null;
}

export const NO_CHANGES: EntryChanges = {
  entries: new Map(),
  removed: 0,
  unchanged: false,
  op: null,
};

/**
 * Entries of a collection as (identity, value identity) pairs:
 * lists by index, records by field name, maps by key, sets by value.
 */
const entriesOf = (object: HeapObject): Array<readonly [string, string]> => {
  switch (object.kind) {
    case "list":
      return object.items.map((item, i) => [String(i), valueIdentity(item)] as const);
    case "record":
    case "instance":
      return object.fields.map(([name, value]) => [name, valueIdentity(value)] as const);
    case "map":
      return object.entries.map(([k, v]) => [valueIdentity(k), valueIdentity(v)] as const);
    case "set":
      return object.items.map((item) => [valueIdentity(item), ""] as const);
    case "callable":
    case "opaque":
      return [];
  }
};

/** Identity under which {@link changesOf} reports a map key or set value. */
export const entryKey = (value: EncodedValue): string => valueIdentity(value);

/**
 * Compares an object with its state before the current step. Objects first seen in this
 * step report every entry as added only when an operation created them; plain first sight
 * (e.g. a literal being declared) is not a change.
 */
export const changesOf = (
  object: HeapObject,
  mutation: HeapMutation | undefined,
  change: HeapChange | undefined,
): EntryChanges => {
  if (!mutation) return NO_CHANGES;
  const after = entriesOf(object);
  if (!mutation.before) {
    return {
      entries: new Map(after.map(([key]) => [key, "added" as const])),
      removed: 0,
      unchanged: false,
      op: mutation.op,
    };
  }
  const before = new Map(entriesOf(mutation.before));
  const entries = new Map<string, EntryChange>();
  for (const [key, value] of after) {
    const old = before.get(key);
    if (old === undefined) entries.set(key, "added");
    else if (old !== value) entries.set(key, "updated");
  }
  // A slot written with the value it already held is still a write the program performed.
  if (change && change !== "all") {
    for (const key of change) if (!entries.has(String(key))) entries.set(String(key), "updated");
  }
  const keys = new Set(after.map(([key]) => key));
  const removed = [...before.keys()].filter((key) => !keys.has(key)).length;
  return {
    entries,
    removed,
    unchanged: entries.size === 0 && removed === 0 && change === "all" && sameOrder(before, after),
    op: mutation.op,
  };
};

const sameOrder = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyArray<readonly [string, string]>,
): boolean => [...before.keys()].every((key, i) => after[i]?.[0] === key);

/** {@link changesOf} for an object as it appears in a step view. */
export const changesIn = (view: StepView, object: HeapObject): EntryChanges =>
  changesOf(object, view.mutations.get(object.id), view.heapChanges.get(object.id));
