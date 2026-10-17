import type { ComplexityClass } from "./complexity";

/**
 * Symbolic costs over several input sizes: `O(n + m)`, `O(n·m)`, `O(n log m)`, `O(2ⁿ)`.
 * A cost is a sum of terms; a term is a product of size variables raised to powers, times
 * logarithms of size variables, or exponential in one variable. All functions are pure.
 */
export interface Term {
  readonly powers: Readonly<Record<string, number>>;
  readonly logs: Readonly<Record<string, number>>;
  /** The variable `v` of `2^v`, when the term is exponential. */
  readonly exp: string | null;
}

/** A sum of terms; the empty sum is `O(1)`. */
export type Cost = readonly Term[];

export const ONE: Cost = [];

/** Letters for size variables, in the order they are handed out and written. */
export const SIZE_LETTERS = ["n", "m", "k", "p", "q", "r", "s", "t", "v", "w"] as const;

const term = (powers: Term["powers"], logs: Term["logs"], exp: string | null = null): Term => ({
  powers,
  logs,
  exp,
});

export const size = (variable: string): Cost => [term({ [variable]: 1 }, {})];
export const logOf = (variable: string): Cost => [term({}, { [variable]: 1 })];
export const exponentialIn = (variable: string): Cost => [term({}, {}, variable)];

export const isConstant = (cost: Cost): boolean => cost.length === 0;

const addExponents = (
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> => {
  const out: Record<string, number> = { ...a };
  for (const [v, e] of Object.entries(b)) out[v] = (out[v] ?? 0) + e;
  return out;
};

const variablesOf = (t: Term): string[] => [
  ...new Set([...Object.keys(t.powers), ...Object.keys(t.logs)]),
];

/** True when `u` grows at least as fast as `t` in every variable. */
const dominates = (u: Term, t: Term): boolean => {
  if (t.exp !== null) return u.exp !== null;
  if (u.exp !== null) return true;
  return [...new Set([...variablesOf(u), ...variablesOf(t)])].every((v) => {
    const [pu, pt] = [u.powers[v] ?? 0, t.powers[v] ?? 0];
    return pu > pt || (pu === pt && (u.logs[v] ?? 0) >= (t.logs[v] ?? 0));
  });
};

const sameTerm = (a: Term, b: Term): boolean => dominates(a, b) && dominates(b, a);

/** Drops terms another term grows at least as fast as (keeping the first of equals). */
const simplify = (terms: readonly Term[]): Cost =>
  terms.filter((t, i) =>
    terms.every((u, j) => j === i || !dominates(u, t) || (sameTerm(u, t) && i < j)),
  );

/** Cost of sequential code: the terms that dominate. */
export const add = (...costs: readonly Cost[]): Cost => simplify(costs.flat());

/** Cost of doing `b` once for every step of `a`. */
export const multiply = (a: Cost, b: Cost): Cost => {
  if (isConstant(a)) return b;
  if (isConstant(b)) return a;
  return simplify(
    a.flatMap((x) =>
      b.map((y) =>
        x.exp !== null || y.exp !== null
          ? term({}, {}, x.exp ?? y.exp)
          : term(addExponents(x.powers, y.powers), addExponents(x.logs, y.logs)),
      ),
    ),
  );
};

/** True when `part` supplies at least one of `whole`'s terms (it is not dominated away). */
export const contributes = (part: Cost, whole: Cost): boolean =>
  isConstant(whole) ? isConstant(part) : part.some((t) => whole.some((w) => sameTerm(t, w)));

/** Every variable a cost mentions, in first-seen order. */
export const variablesIn = (cost: Cost): string[] => [
  ...new Set(cost.flatMap((t) => [...variablesOf(t), ...(t.exp === null ? [] : [t.exp])])),
];

/** Renames variables (sizes are analysed by source name, then shown as letters). */
export const renameCost = (cost: Cost, rename: (variable: string) => string): Cost => {
  const renamed = (r: Readonly<Record<string, number>>) =>
    Object.fromEntries(Object.entries(r).map(([v, e]) => [rename(v), e]));
  return cost.map((t) =>
    term(renamed(t.powers), renamed(t.logs), t.exp === null ? null : rename(t.exp)),
  );
};

const totalExponent = (r: Readonly<Record<string, number>>): number =>
  Object.values(r).reduce((sum, e) => sum + e, 0);

/** The single-variable class a cost reduces to when every size is the same `n`. */
export const toClass = (cost: Cost): ComplexityClass =>
  cost.reduce<ComplexityClass>(
    (best, t) => {
      if (t.exp !== null) return { poly: 0, log: 0, exp: true };
      if (best.exp) return best;
      const candidate = { poly: totalExponent(t.powers), log: totalExponent(t.logs), exp: false };
      return candidate.poly > best.poly ||
        (candidate.poly === best.poly && candidate.log > best.log)
        ? candidate
        : best;
    },
    { poly: 0, log: 0, exp: false },
  );

/**
 * A cost's value with every size equal to `n`, constant factors dropped (logarithms are
 * log₂(n + 1), so n = 0 stays finite). For plotting how parts of a program grow.
 */
export const evaluateCost = (cost: Cost, n: number): number => {
  if (isConstant(cost)) return 1;
  const log = Math.log2(n + 1);
  return cost.reduce(
    (sum, t) =>
      sum + (t.exp !== null ? 2 ** n : n ** totalExponent(t.powers) * log ** totalExponent(t.logs)),
    0,
  );
};

// ---------------------------------------------------------------- notation

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  n: "ⁿ",
  m: "ᵐ",
  k: "ᵏ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
};

/** `base` raised to `exponent` in superscript, e.g. `n²`; falls back to `^` for other text. */
export const power = (base: string, exponent: number | string): string => {
  const text = String(exponent);
  if (text === "1") return base;
  const chars = [...text].map((c) => SUPERSCRIPT[c]);
  return chars.every(Boolean) ? `${base}${chars.join("")}` : `${base}^${text}`;
};

const degree = (t: Term): number => (t.exp !== null ? Infinity : totalExponent(t.powers));

const formatTerm = (t: Term, order: readonly string[]): string => {
  if (t.exp !== null) return power("2", t.exp);
  const sequence: readonly string[] = [...order, ...SIZE_LETTERS];
  const rank = (v: string) => (sequence.includes(v) ? sequence.indexOf(v) : sequence.length);
  const sorted = (r: Readonly<Record<string, number>>) =>
    Object.entries(r)
      .filter(([, e]) => e > 0)
      .toSorted(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  const powers = sorted(t.powers).map(([v, e]) => power(v, e));
  const logs = sorted(t.logs).map(([v, e]) => (e === 1 ? `log ${v}` : `log${power("", e)} ${v}`));
  const parts = [...(powers.length > 0 ? [powers.join("·")] : []), ...logs];
  return parts.length > 0 ? parts.join(" ") : "1";
};

/** The cost without `O(...)`, e.g. `n·m + k`; terms of higher degree come first. */
export const formatCostBody = (cost: Cost, order: readonly string[] = []): string =>
  isConstant(cost)
    ? "1"
    : cost
        .toSorted((a, b) => degree(b) - degree(a))
        .map((t) => formatTerm(t, order))
        .join(" + ");

/** Big-O notation, e.g. `O(1)`, `O(n + m)`, `O(n·m)`, `O(n² log n)`, `O(2ⁿ)`. */
export const formatCost = (cost: Cost, order: readonly string[] = []): string =>
  `O(${formatCostBody(cost, order)})`;
