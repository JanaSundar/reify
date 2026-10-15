import { describe, expect, it } from "vitest";
import type { RuntimeWorkerMessage } from "@/engine/core/protocol/messages";
import type { TestCase, TestResult, TestSuite } from "@/engine/core/protocol/testing";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";
import { deepEqual, measureInputSize } from "@/engine/languages/javascript/runtime/jsCompare";
import { handleTest } from "@/engine/workers/handlers";
import { TEST_LIMITS } from "../helpers";

const cases = (...pairs: Array<[string, string]>): TestCase[] =>
  pairs.map(([args, expected], i) => ({ id: `c${i}`, args, expected }));

const runSuite = async (
  source: string,
  suite: Omit<TestSuite, "target"> & { target?: TestSuite["target"] },
  limits = TEST_LIMITS,
): Promise<{ results: TestResult[]; messages: RuntimeWorkerMessage[] }> => {
  const compiled = new JavaScriptCompiler("javascript", false).compile(source);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join("; "));
  const messages: RuntimeWorkerMessage[] = [];
  await handleTest(
    {
      type: "test",
      runId: 1,
      languageId: "javascript",
      code: compiled.code,
      suite: { target: "return", ...suite },
      limits,
    },
    { post: (m) => messages.push(m), now: () => 0, lockdown: () => undefined },
  );
  const results = messages.flatMap((m) => (m.type === "test-result" ? [m.result] : []));
  return { results, messages };
};

const TWO_SUM = `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
    seen.set(nums[i], i);
  }
  return null;
}`;

describe("test runner", () => {
  it("reports pass and fail with actual and expected values", async () => {
    const { results, messages } = await runSuite(TWO_SUM, {
      entry: "twoSum",
      cases: cases(["[2, 7, 11, 15], 9", "[0, 1]"], ["[3, 2, 4], 6", "[0, 2]"]),
    });
    expect(results.map((r) => r.status)).toEqual(["pass", "fail"]);
    expect(results[1]).toMatchObject({ actual: "[1, 2]", expected: "[0, 2]", inputSize: 3 });
    expect(results[0]!.steps).toBeGreaterThan(0);
    expect(messages.at(-1)).toMatchObject({ type: "done", outcome: { kind: "ok" } });
  });

  it("checks in-place mutations of the first argument", async () => {
    const source =
      "function reverse(a) { for (let i = 0, j = a.length - 1; i < j; i++, j--) [a[i], a[j]] = [a[j], a[i]]; }";
    const { results } = await runSuite(source, {
      entry: "reverse",
      target: "first-argument",
      cases: cases(["[1, 2, 3]", "[3, 2, 1]"]),
    });
    expect(results[0]?.status).toBe("pass");
  });

  it("lets test cases use helpers defined by the program", async () => {
    const source = `class Node { constructor(v, next = null) { this.v = v; this.next = next; } }
const list = (...xs) => xs.reduceRight((next, v) => new Node(v, next), null);
function length(head) { let n = 0; while (head) { n++; head = head.next; } return n; }`;
    const { results } = await runSuite(source, {
      entry: "length",
      cases: cases(["list(1, 2, 3, 4)", "4"]),
    });
    expect(results[0]).toMatchObject({ status: "pass", inputSize: 4 });
  });

  it("isolates cases: a runaway case hits its budget and the next case still runs", async () => {
    const source = "function f(n) { while (n > 0) {} return n; }";
    const { results } = await runSuite(
      source,
      { entry: "f", cases: cases(["1", "1"], ["0", "0"]) },
      { ...TEST_LIMITS, maxSteps: 2_000 },
    );
    expect(results.map((r) => r.status)).toEqual(["limit", "pass"]);
  });

  it("explains errors in the program, the case and the function", async () => {
    const { results } = await runSuite("function f(x) { return x.y.z; }", {
      entry: "f",
      cases: cases(["{}", "1"], ["[1,", "1"], ["1", ""]),
    });
    expect(results.map((r) => r.status)).toEqual(["error", "error", "error"]);
    expect(results[0]?.message).toContain("TypeError");
    expect(results[1]?.message).toContain("not valid JavaScript");
    expect(results[2]?.message).toContain("expected value");
    const missing = await runSuite("const x = 1;", { entry: "solve", cases: cases(["1", "1"]) });
    expect(missing.results[0]?.message).toContain("No function named");
  });

  it("keeps cases independent of each other's state", async () => {
    const source = "let calls = 0;\nfunction count() { calls++; return calls; }";
    const { results } = await runSuite(source, {
      entry: "count",
      cases: cases(["", "1"], ["", "1"]),
    });
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });
});

describe("deepEqual", () => {
  it.each<[unknown, unknown, boolean]>([
    [[1, [2, 3]], [1, [2, 3]], true],
    [[1, 2], [2, 1], false],
    [{ a: 1, b: [2] }, { b: [2], a: 1 }, true],
    [new Map([[1, "a"]]), new Map([[1, "a"]]), true],
    [new Set([1, 2]), new Set([2, 1]), true],
    [NaN, NaN, true],
    [null, undefined, false],
    [{ a: 1 }, { a: 1, b: 2 }, false],
  ])("deepEqual(%o, %o) is %s", (a, b, expected) => {
    expect(deepEqual(a, b)).toBe(expected);
  });

  it("handles cycles", () => {
    const a: Record<string, unknown> = { v: 1 };
    a.self = a;
    const b: Record<string, unknown> = { v: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });
});

describe("measureInputSize", () => {
  it.each<[unknown[], number]>([
    [[[1, 2, 3], 9], 3],
    [["hello"], 5],
    [[30], 30],
    [
      [
        [
          [1, 2],
          [3, 4],
        ],
      ],
      4,
    ],
    [
      [
        new Map([
          [1, 2],
          [3, 4],
        ]),
      ],
      2,
    ],
  ])("measures %o as %i", (args, n) => {
    expect(measureInputSize(args)).toBe(n);
  });
});
