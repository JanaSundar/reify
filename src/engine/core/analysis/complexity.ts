/**
 * Language-neutral complexity classes, their notation, and an empirical estimator that fits
 * measured operation counts against input sizes. All functions are pure.
 */

/** `n^poly · log^log n`, or exponential growth when `exp` is set. */
export interface ComplexityClass {
  readonly poly: number;
  readonly log: number;
  readonly exp: boolean;
}

export const constant: ComplexityClass = { poly: 0, log: 0, exp: false };
export const linear: ComplexityClass = { poly: 1, log: 0, exp: false };
export const logarithmic: ComplexityClass = { poly: 0, log: 1, exp: false };
export const exponential: ComplexityClass = { poly: 0, log: 0, exp: true };

export const complexity = (poly: number, log = 0): ComplexityClass => ({ poly, log, exp: false });

/** Cost of doing `b` once for every step of `a` (nested loops, calls inside loops). */
export const multiply = (a: ComplexityClass, b: ComplexityClass): ComplexityClass =>
  a.exp || b.exp ? exponential : complexity(a.poly + b.poly, a.log + b.log);

/** Orders classes by growth: negative when `a` grows slower than `b`. */
export const compareClass = (a: ComplexityClass, b: ComplexityClass): number => {
  if (a.exp !== b.exp) return a.exp ? 1 : -1;
  return a.poly - b.poly || a.log - b.log;
};

/** The dominant of two costs (sequential code). */
export const dominant = (a: ComplexityClass, b: ComplexityClass): ComplexityClass =>
  compareClass(a, b) >= 0 ? a : b;

export const sameClass = (a: ComplexityClass, b: ComplexityClass): boolean =>
  compareClass(a, b) === 0;

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
};

const power = (base: string, exponent: number): string =>
  exponent === 1
    ? base
    : `${base}${[...String(exponent)].map((d) => SUPERSCRIPT[d] ?? d).join("")}`;

/** Big-O notation, e.g. `O(1)`, `O(log n)`, `O(n² log n)`, `O(2ⁿ)`. */
export const formatComplexity = (c: ComplexityClass): string => {
  if (c.exp) return "O(2ⁿ)";
  const parts: string[] = [];
  if (c.poly > 0) parts.push(power("n", c.poly));
  if (c.log > 0) parts.push(c.log === 1 ? "log n" : `log${power("", c.log)} n`);
  return `O(${parts.length > 0 ? parts.join(" ") : "1"})`;
};

// ---------------------------------------------------------------- empirical estimate

export interface Sample {
  /** Input size. */
  readonly n: number;
  /** Operations counted while solving that input. */
  readonly steps: number;
}

export type Confidence = "low" | "medium" | "high";

export type EmpiricalEstimate =
  | {
      readonly kind: "estimate";
      readonly complexity: ComplexityClass;
      readonly confidence: Confidence;
      /** Fitted curve `steps ≈ intercept + scale · f(n)`, for plotting. */
      readonly intercept: number;
      readonly scale: number;
      readonly points: readonly Sample[];
    }
  | { readonly kind: "insufficient"; readonly reason: string; readonly points: readonly Sample[] };

/** Candidate growth classes, simplest first (ties go to the simpler class). */
const CANDIDATES: readonly ComplexityClass[] = [
  constant,
  logarithmic,
  linear,
  complexity(1, 1),
  complexity(2),
  complexity(2, 1),
  complexity(3),
  exponential,
];

const MAX_GROWTH = 1e15;

/** Value of `f(n)` for a class; `log` uses log₂(n + 1) so that n = 0 stays finite. */
export const growth = (c: ComplexityClass, n: number): number => {
  if (c.exp) return 2 ** n;
  return n ** c.poly * Math.log2(n + 1) ** c.log;
};

interface Fit {
  readonly complexity: ComplexityClass;
  readonly intercept: number;
  readonly scale: number;
  readonly error: number;
}

/** Least-squares fit of `y ≈ a + b·x` with `b ≥ 0`; error is measured in log space. */
const fit = (c: ComplexityClass, points: readonly Sample[]): Fit | null => {
  const xs = points.map((p) => growth(c, p.n));
  if (xs.some((x) => !Number.isFinite(x) || x > MAX_GROWTH)) return null;
  const ys = points.map((p) => p.steps);
  const meanX = xs.reduce((s, x) => s + x, 0) / xs.length;
  const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    sxy += (x - meanX) * (ys[i]! - meanY);
    sxx += (x - meanX) ** 2;
  });
  const scale = sxx > 0 ? Math.max(0, sxy / sxx) : 0;
  const intercept = meanY - scale * meanX;
  const error =
    xs.reduce((sum, x, i) => {
      const predicted = Math.max(1, intercept + scale * x);
      return sum + (Math.log(predicted) - Math.log(Math.max(1, ys[i]!))) ** 2;
    }, 0) / xs.length;
  return { complexity: c, intercept, scale, error };
};

const MIN_SIZES = 3;
const MIN_RANGE = 4;
/** A more complex class must beat a simpler one by this factor to be chosen. */
const SIMPLER_TOLERANCE = 1.25;

/** Averages repeated sizes so each `n` contributes one point. */
const bySize = (samples: readonly Sample[]): Sample[] => {
  const groups = new Map<number, number[]>();
  for (const { n, steps } of samples) groups.set(n, [...(groups.get(n) ?? []), steps]);
  return [...groups]
    .map(([n, steps]) => ({ n, steps: steps.reduce((s, x) => s + x, 0) / steps.length }))
    .toSorted((a, b) => a.n - b.n);
};

/**
 * Estimates the growth class that best explains how operation counts change with input
 * size. Needs at least three distinct sizes spanning a 4× range.
 */
export const estimateComplexity = (samples: readonly Sample[]): EmpiricalEstimate => {
  const points = bySize(samples.filter((s) => Number.isFinite(s.n) && s.n >= 0));
  const smallest = points[0]?.n ?? 0;
  const largest = points.at(-1)?.n ?? 0;
  if (points.length < MIN_SIZES) {
    return {
      kind: "insufficient",
      reason: `Add test cases with at least ${MIN_SIZES} different input sizes (now ${points.length}).`,
      points,
    };
  }
  if (largest < MIN_RANGE * Math.max(1, smallest)) {
    return {
      kind: "insufficient",
      reason: `Make the largest input at least ${MIN_RANGE}× the smallest (now ${smallest} to ${largest}).`,
      points,
    };
  }
  const fits = CANDIDATES.map((c) => fit(c, points)).filter((f): f is Fit => f !== null);
  const best = fits.reduce((a, b) => (b.error < a.error ? b : a));
  const chosen = fits.find((f) => f.error <= best.error * SIMPLER_TOLERANCE + 1e-4) ?? best;
  const range = largest / Math.max(1, smallest);
  const confidence: Confidence =
    points.length >= 4 && range >= 10 && chosen.error < 0.02
      ? "high"
      : chosen.error < 0.1
        ? "medium"
        : "low";
  return {
    kind: "estimate",
    complexity: chosen.complexity,
    confidence,
    intercept: chosen.intercept,
    scale: chosen.scale,
    points,
  };
};

// ---------------------------------------------------------------- static estimate

/** A compile-time estimate with human-readable reasons. */
export interface StaticComplexity {
  readonly time: ComplexityClass;
  /** Short factual notes, e.g. "2 nested loops in `twoSum`". */
  readonly notes: readonly string[];
}
