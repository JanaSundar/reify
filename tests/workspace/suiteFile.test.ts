import { describe, expect, it } from "vitest";
import { MAX_SUITE_CASES, parseSuiteFile, suiteTemplate } from "@/features/tests/suiteFile";

const parse = (value: unknown) => parseSuiteFile(JSON.stringify(value));

describe("parseSuiteFile", () => {
  it("turns JSON arguments and expectations into source code", () => {
    const result = parse({
      entry: "twoSum",
      cases: [{ args: [[2, 7, 11, 15], 9], expected: [0, 1] }],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.suite.entry).toBe("twoSum");
    expect(result.suite.target).toBe("return");
    expect(result.suite.cases[0]).toMatchObject({ args: "[2,7,11,15], 9", expected: "[0,1]" });
  });

  it("keeps strings as source and accepts the in-place target", () => {
    const result = parse({
      entry: "sortInPlace",
      target: "first-argument",
      cases: [{ args: "[3, 1, 2]", expected: "[1, 2, 3]" }],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.suite.target).toBe("first-argument");
    expect(result.suite.cases[0]).toMatchObject({ args: "[3, 1, 2]", expected: "[1, 2, 3]" });
  });

  it("gives every case its own id", () => {
    const result = parse({
      entry: "f",
      cases: [
        { args: [1], expected: 1 },
        { args: [2], expected: 2 },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    expect(new Set(result.suite.cases.map((c) => c.id)).size).toBe(2);
  });

  it.each([
    ["not json", "That file isn't valid JSON."],
    [JSON.stringify([]), "The file must contain a JSON object with an entry and cases."],
    [JSON.stringify({ entry: "not a name", cases: [] }), '"entry" must be the name'],
    [JSON.stringify({ entry: "f", target: "nope", cases: [] }), '"target" must be'],
    [JSON.stringify({ entry: "f" }), '"cases" must be a list.'],
    [JSON.stringify({ entry: "f", cases: [5] }), "Case 1 must be an object"],
    [JSON.stringify({ entry: "f", cases: [{ expected: 1 }] }), 'Case 1: "args" must be a list'],
    [JSON.stringify({ entry: "f", cases: [{ args: [1] }] }), 'Case 1 needs an "expected" value.'],
    [JSON.stringify({ entry: "f", cases: [{ args: [1], expected: "  " }] }), "needs an"],
  ])("rejects %s", (text, message) => {
    expect(parseSuiteFile(text)).toEqual({
      ok: false,
      error: expect.stringContaining(message),
    });
  });

  it("limits the number of cases", () => {
    const cases = Array.from({ length: MAX_SUITE_CASES + 1 }, () => ({ args: [1], expected: 1 }));
    const result = parse({ entry: "f", cases });
    expect(result.ok).toBe(false);
  });
});

describe("suiteTemplate", () => {
  it("is a valid suite for the given function", () => {
    const result = parseSuiteFile(suiteTemplate("clamp"));
    if (!result.ok) throw new Error(result.error);
    expect(result.suite.entry).toBe("clamp");
    expect(result.suite.cases.length).toBeGreaterThan(0);
  });

  it("falls back to a placeholder name when the function is unknown", () => {
    const result = parseSuiteFile(suiteTemplate(""));
    if (!result.ok) throw new Error(result.error);
    expect(result.suite.entry).toBe("myFunction");
  });
});
