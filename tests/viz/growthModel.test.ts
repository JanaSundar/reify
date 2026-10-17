import { describe, expect, it } from "vitest";
import { formatCost } from "@/engine/core/analysis/cost";
import { estimateStatic, type CostNode } from "@/engine/core/analysis/staticEstimate";
import { growthModel, MAX_SERIES } from "@/features/complexity/growthModel";

const loop = (line: number, over: string, body: CostNode[] = []): CostNode => ({
  kind: "loop",
  line,
  label: `for x in ${over}`,
  over,
  halving: false,
  body,
});

const modelOf = (body: CostNode[]) => {
  const analysis = estimateStatic({ body, functions: {}, aliases: {} });
  return growthModel(analysis, (cost) => formatCost(cost, ["n", "m"]));
};

const deep = (depth: number): CostNode =>
  depth === 1 ? loop(depth, "xs") : loop(depth, "xs", [deep(depth - 1)]);

describe("growth model", () => {
  it("plots one line per distinct cost, fastest first", () => {
    const model = modelOf([loop(1, "xs"), loop(2, "xs", [loop(3, "ys")]), loop(4, "xs")]);
    expect(model.series.map((s) => s.label)).toEqual(["O(n·m)", "O(n)"]);
    expect(model.series[0]).toMatchObject({ source: "L2 for x in xs", dominant: true });
    expect(model.series[1]).toMatchObject({ source: "L1, L4 (2 parts)", dominant: false });
  });

  it("grows each line with n", () => {
    const [nm] = modelOf([loop(1, "xs", [loop(2, "ys")])]).series;
    expect(nm!.values.slice(0, 3)).toEqual([1, 4, 9]);
  });

  it("keeps the plot to the fastest-growing parts", () => {
    const model = modelOf([deep(1), deep(2), deep(3), deep(4)]);
    expect(model.series).toHaveLength(MAX_SERIES);
    expect(model.hidden).toBe(1);
  });
});
