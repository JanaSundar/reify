import { describe, expect, it } from "vitest";
import {
  add,
  contributes,
  exponentialIn,
  formatCost,
  logOf,
  multiply,
  ONE,
  size,
  toClass,
} from "@/engine/core/analysis/cost";
import {
  estimateStatic,
  type CostNode,
  type CostShape,
} from "@/engine/core/analysis/staticEstimate";

const n = size("n");
const m = size("m");

describe("cost algebra", () => {
  it.each([
    ["a constant", ONE, "O(1)"],
    ["sequential sizes", add(n, m), "O(n + m)"],
    ["nested sizes", multiply(n, m), "O(n·m)"],
    ["a square", multiply(n, n), "O(n²)"],
    ["n log n", multiply(n, logOf("n")), "O(n log n)"],
    ["a dominated term", add(n, multiply(n, m)), "O(n·m)"],
    ["an exponential", add(multiply(n, n), exponentialIn("n")), "O(2ⁿ)"],
    ["mixed degrees", add(m, multiply(n, n)), "O(n² + m)"],
  ])("formats %s", (_name, cost, text) => {
    expect(formatCost(cost)).toBe(text);
  });

  it("orders variables as asked", () => {
    expect(formatCost(multiply(m, n), ["n", "m"])).toBe("O(n·m)");
  });

  it("tells which parts survive a sum", () => {
    const whole = add(n, multiply(n, m));
    expect(contributes(multiply(n, m), whole)).toBe(true);
    expect(contributes(n, whole)).toBe(false);
  });

  it("collapses to one size for comparison with measurements", () => {
    expect(toClass(add(multiply(n, m), m))).toEqual({ poly: 2, log: 0, exp: false });
  });
});

const loop = (line: number, over: string | null, body: CostNode[] = []): CostNode => ({
  kind: "loop",
  line,
  label: `for x in ${over}`,
  over,
  halving: false,
  body,
});

const program = (body: CostNode[], functions: CostShape["functions"] = {}): CostShape => ({
  body,
  functions,
  aliases: {},
});

describe("static estimate", () => {
  it("names sizes by what they measure", () => {
    const estimate = estimateStatic(program([loop(1, "xs", [loop(2, "ys")])]));
    expect(formatCost(estimate.time, ["n", "m"])).toBe("O(n·m)");
    expect(estimate.sizes).toEqual([
      { name: "n", of: "xs" },
      { name: "m", of: "ys" },
    ]);
  });

  it("explains each step and marks which ones dominate", () => {
    const estimate = estimateStatic(program([loop(1, "xs"), loop(2, "xs", [loop(3, "ys")])]));
    const [first, second] = estimate.steps;
    expect(first).toMatchObject({ dominant: false, reason: expect.stringContaining("xs") });
    expect(second).toMatchObject({
      dominant: true,
      children: [{ reason: expect.stringContaining("O(m)") }],
    });
  });

  it("measures a function's loops by the arguments of each call", () => {
    const estimate = estimateStatic(
      program(
        [loop(5, "xs", [{ kind: "call", line: 6, label: "total(ys)", fn: "total", args: ["ys"] }])],
        {
          total: {
            name: "total",
            params: ["items"],
            recursion: "none",
            selfCalls: 0,
            body: [loop(2, "items")],
            aliases: {},
          },
        },
      ),
    );
    expect(formatCost(estimate.time, ["n", "m"])).toBe("O(n·m)");
  });

  it("keeps conventional size names", () => {
    const estimate = estimateStatic(program([loop(1, "k"), loop(2, "xs")]));
    expect(estimate.sizes.map((s) => s.name)).toEqual(["k", "n"]);
  });
});
