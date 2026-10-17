import { evaluateCost, type Cost } from "@/engine/core/analysis/cost";
import type { StaticComplexity } from "@/engine/core/analysis/staticEstimate";

/** At most this many parts are plotted (the validated categorical slots). */
export const MAX_SERIES = 3;

/** One plotted part of the program: top-level steps that share a cost. */
export interface GrowthSeries {
  /** The cost, e.g. `O(n·m)`. */
  readonly label: string;
  /** Where it comes from, e.g. `L9 sorted(xs)` or `L2, L7 (2 parts)`. */
  readonly source: string;
  readonly cost: Cost;
  /** Whether this part decides the overall complexity. */
  readonly dominant: boolean;
  /** Operations at each of {@link GrowthModel.sizes}. */
  readonly values: readonly number[];
}

export interface GrowthModel {
  readonly sizes: readonly number[];
  readonly series: readonly GrowthSeries[];
  /** Parts left out because they grow slowest. */
  readonly hidden: number;
}

/** Plot sizes: a short range when something is exponential, so the rest stays visible. */
const sizesFor = (exponential: boolean): number[] =>
  Array.from({ length: exponential ? 16 : 48 }, (_, i) => i + 1);

/**
 * How each top-level part of the program grows with the input, all sizes taken equal to `n`:
 * parts with the same cost share a line, the fastest-growing lines are kept.
 */
export const growthModel = (
  analysis: StaticComplexity,
  show: (cost: Cost) => string,
): GrowthModel => {
  const groups = new Map<
    string,
    { cost: Cost; lines: number[]; labels: string[]; dominant: boolean }
  >();
  for (const step of analysis.steps) {
    const label = show(step.total);
    const group = groups.get(label) ?? { cost: step.total, lines: [], labels: [], dominant: false };
    groups.set(label, {
      ...group,
      lines: [...group.lines, step.line],
      labels: [...group.labels, step.label],
      dominant: group.dominant || step.dominant,
    });
  }
  const exponential = analysis.time.some((t) => t.exp !== null);
  const sizes = sizesFor(exponential);
  const largest = sizes.at(-1)!;
  const all = [...groups]
    .map(([label, group]) => ({
      label,
      source:
        group.lines.length === 1
          ? `L${group.lines[0]} ${group.labels[0]}`
          : `L${group.lines.join(", L")} (${group.lines.length} parts)`,
      cost: group.cost,
      dominant: group.dominant,
      values: sizes.map((n) => evaluateCost(group.cost, n)),
    }))
    .toSorted((a, b) => evaluateCost(b.cost, largest) - evaluateCost(a.cost, largest));
  return { sizes, series: all.slice(0, MAX_SERIES), hidden: Math.max(0, all.length - MAX_SERIES) };
};
