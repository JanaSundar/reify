import { describe, expect, it } from "vitest";
import {
  complexity,
  estimateComplexity,
  exponential,
  formatComplexity,
  growth,
  type ComplexityClass,
} from "@/engine/core/analysis/complexity";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";
import { CORPUS } from "../corpus/programs";

const staticOf = (source: string): string => {
  const result = new JavaScriptCompiler("javascript", false).compile(source);
  return result.ok && result.program.complexity
    ? formatComplexity(result.program.complexity.time)
    : "n/a";
};

describe("complexity notation", () => {
  it.each<[ComplexityClass, string]>([
    [complexity(0), "O(1)"],
    [complexity(0, 1), "O(log n)"],
    [complexity(1), "O(n)"],
    [complexity(1, 1), "O(n log n)"],
    [complexity(2), "O(n²)"],
    [complexity(3, 2), "O(n³ log² n)"],
    [exponential, "O(2ⁿ)"],
  ])("formats %o as %s", (c, text) => {
    expect(formatComplexity(c)).toBe(text);
  });
});

describe("static estimate", () => {
  it.each([
    ["constant work", "const a = 1 + 2;\nconsole.log(a);", "O(1)"],
    [
      "a single loop with Map lookups",
      "const m = new Map();\nfor (let i = 0; i < 10; i++) { if (m.has(i)) m.get(i); m.set(i, i); }",
      "O(n)",
    ],
    ["nested loops", CORPUS.nestedLoops!, "O(n²)"],
    ["binary search", CORPUS.binarySearch!, "O(log n)"],
    ["naive recursion", CORPUS.fibonacci!, "O(2ⁿ)"],
    [
      "memoized recursion",
      "const memo = new Map();\nfunction f(n) { if (n < 2) return n; if (memo.has(n)) return memo.get(n); const r = f(n - 1) + f(n - 2); memo.set(n, r); return r; }\nf(10);",
      "O(n)",
    ],
    [
      "sorting then scanning",
      "const a = [3, 1, 2];\na.sort((x, y) => x - y);\nfor (const x of a) console.log(x);",
      "O(n log n)",
    ],
    [
      "merge sort",
      "function sort(a) { if (a.length < 2) return a; const mid = a.length >> 1; const l = sort(a.slice(0, mid)); const r = sort(a.slice(mid)); const out = []; let i = 0, j = 0; while (i < l.length || j < r.length) { out.push(j >= r.length || (i < l.length && l[i] <= r[j]) ? l[i++] : r[j++]); } return out; }\nsort([3, 1, 2]);",
      "O(n log n)",
    ],
    ["shift() inside a loop", "const q = [1, 2, 3];\nwhile (q.length) { q.shift(); }", "O(n²)"],
    [
      "a helper called inside a loop",
      "function sum(a) { let s = 0; for (const x of a) s += x; return s; }\nfor (let i = 0; i < 5; i++) sum([1, 2]);",
      "O(n²)",
    ],
  ])("estimates %s", (_name, source, expected) => {
    expect(staticOf(source)).toBe(expected);
  });

  it("explains its estimate", () => {
    const result = new JavaScriptCompiler("javascript", false).compile(CORPUS.fibonacci!);
    expect(result.ok && result.program.complexity?.notes.join(" ")).toContain(
      "calls itself 2 times",
    );
  });
});

const samplesFor = (c: ComplexityClass, sizes: number[], overhead = 5) =>
  sizes.map((n) => ({ n, steps: Math.round(overhead + 3 * growth(c, n)) }));

describe("empirical estimate", () => {
  it.each<[ComplexityClass, number[]]>([
    [complexity(0), [10, 100, 1000, 10000]],
    [complexity(0, 1), [10, 100, 1000, 10000, 100000]],
    [complexity(1), [10, 50, 100, 500, 1000]],
    [complexity(1, 1), [16, 64, 256, 1024, 4096]],
    [complexity(2), [5, 10, 20, 40, 80]],
    [complexity(3), [4, 8, 16, 32]],
    [exponential, [4, 8, 12, 16, 20]],
  ])("recovers %o from measured operation counts", (c, sizes) => {
    const estimate = estimateComplexity(samplesFor(c, sizes));
    expect(estimate.kind).toBe("estimate");
    expect(estimate.kind === "estimate" ? formatComplexity(estimate.complexity) : "").toBe(
      formatComplexity(c),
    );
  });

  it("asks for more varied input sizes", () => {
    expect(
      estimateComplexity([
        { n: 3, steps: 10 },
        { n: 4, steps: 12 },
      ]),
    ).toMatchObject({ kind: "insufficient" });
    expect(
      estimateComplexity([
        { n: 3, steps: 10 },
        { n: 4, steps: 12 },
        { n: 5, steps: 14 },
      ]),
    ).toMatchObject({
      kind: "insufficient",
    });
  });
});
