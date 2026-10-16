import type { EncodedValue } from "@/engine/core/protocol/values";

/**
 * Identity of a value for matching across steps: heap objects by id, primitives by type and
 * display text. Two equal primitives are indistinguishable, so callers treat them as such.
 */
export const valueIdentity = (value: EncodedValue): string =>
  value.kind === "ref" ? `#${value.id}` : `${value.type}:${value.text}`;

/** Presentation-only identity of list cells, carried from one rendered state to the next. */
export interface CellKeys {
  readonly identities: readonly string[];
  readonly keys: readonly string[];
  /** Counter for keys of cells that did not exist before. */
  readonly next: number;
}

export const EMPTY_KEYS: CellKeys = { identities: [], keys: [], next: 0 };

const isPermutation = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const id of a) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of b) {
    const count = counts.get(id);
    if (!count) return false;
    counts.set(id, count - 1);
  }
  return true;
};

/** Largest middle section aligned with a full LCS table; bigger sections fall back to position. */
const MAX_LCS_CELLS = 250_000;

/** Pairs of (previous index, next index) of a longest common subsequence. */
const alignMiddle = (
  prev: readonly string[],
  next: readonly string[],
): Array<readonly [number, number]> => {
  const n = prev.length;
  const m = next.length;
  if (n * m > MAX_LCS_CELLS) {
    return Array.from({ length: Math.min(n, m) }, (_, i) => [i, i] as const);
  }
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] =
        prev[i] === next[j]
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
    }
  }
  const pairs: Array<readonly [number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (prev[i] === next[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) i++;
    else j++;
  }
  return pairs;
};

/**
 * Assigns React keys to the cells of a list so that motion follows the runtime change:
 *
 * - same length, same values in a different order (sort, swap): cells move with their value;
 * - same length otherwise (slot writes): cells stay in place and their value changes;
 * - different length (push, shift, splice, ...): the unchanged cells keep their keys, the
 *   rest enter or leave.
 *
 * Pure: the result depends only on the previously rendered keys and the new values.
 */
export const reconcileKeys = (previous: CellKeys, values: readonly EncodedValue[]): CellKeys => {
  const identities = values.map(valueIdentity);
  const prev = previous.identities;
  let next = previous.next;
  const fresh = (): string => `c${next++}`;

  if (prev.length === identities.length) {
    if (!isPermutation(prev, identities) || prev.every((id, i) => id === identities[i])) {
      return { identities, keys: previous.keys, next };
    }
    const unused = new Map<string, string[]>();
    prev.forEach((id, i) => unused.set(id, [...(unused.get(id) ?? []), previous.keys[i]!]));
    return { identities, keys: identities.map((id) => unused.get(id)!.shift()!), next };
  }

  const keys: string[] = Array.from({ length: identities.length });
  let start = 0;
  while (start < prev.length && start < identities.length && prev[start] === identities[start]) {
    keys[start] = previous.keys[start]!;
    start++;
  }
  let endPrev = prev.length;
  let endNext = identities.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === identities[endNext - 1]) {
    keys[--endNext] = previous.keys[--endPrev]!;
  }
  for (const [i, j] of alignMiddle(prev.slice(start, endPrev), identities.slice(start, endNext))) {
    keys[start + j] = previous.keys[start + i]!;
  }
  // Heap objects have real identity: one that moved keeps its key even outside the alignment.
  const used = new Set(keys.filter(Boolean));
  const leftovers = new Map<string, string>();
  prev.forEach((id, i) => {
    if (id.startsWith("#") && !used.has(previous.keys[i]!)) leftovers.set(id, previous.keys[i]!);
  });
  for (let j = 0; j < keys.length; j++) {
    const moved = keys[j] === undefined ? leftovers.get(identities[j]!) : undefined;
    if (moved) leftovers.delete(identities[j]!);
    keys[j] ??= moved ?? fresh();
  }
  return { identities, keys, next };
};

/** Keys for a list seen for the first time. */
export const initialKeys = (values: readonly EncodedValue[]): CellKeys =>
  reconcileKeys(EMPTY_KEYS, values);
