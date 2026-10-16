import type { TestCase, TestResult, TestSuite } from "@/engine/core/protocol/testing";
import type { Sample } from "@/engine/core/analysis/complexity";
import type { LanguageId } from "@/engine/languages/catalog";

/** Pure helpers for editing and summarizing a test suite. */

const DECLARATION =
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g;

/** Top-level Python functions (`def name(` at the start of a line). */
const PYTHON_DECLARATION = /^def\s+([A-Za-z_]\w*)\s*\(/gm;

/** Names of functions declared in the source, in order of appearance. */
export const detectFunctionNames = (source: string, languageId: LanguageId): string[] => {
  const names = new Set<string>();
  const pattern = languageId === "python" ? PYTHON_DECLARATION : DECLARATION;
  for (const match of source.matchAll(pattern)) {
    const name = match[1] ?? match[2];
    if (name) names.add(name);
  }
  return [...names];
};

let counter = 0;
export const newCaseId = (): string =>
  `case-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const addCase = (suite: TestSuite): TestSuite => ({
  ...suite,
  cases: [...suite.cases, { id: newCaseId(), args: "", expected: "" }],
});

export const updateCase = (
  suite: TestSuite,
  id: string,
  patch: Partial<Omit<TestCase, "id">>,
): TestSuite => ({
  ...suite,
  cases: suite.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)),
});

export const removeCase = (suite: TestSuite, id: string): TestSuite => ({
  ...suite,
  cases: suite.cases.filter((c) => c.id !== id),
});

/**
 * Source that runs a single case visibly, for tracing it step by step. The call is appended
 * after the user's program, so the trace shows the program and then the call.
 */
export const traceSourceFor = (
  source: string,
  suite: TestSuite,
  testCase: TestCase,
  languageId: LanguageId,
): string => {
  if (languageId === "python") {
    const call =
      suite.target === "first-argument"
        ? `args = [${testCase.args}]\n${suite.entry}(*args)\nprint(args[0])`
        : `print(${suite.entry}(${testCase.args}))`;
    return `${source.trimEnd()}\n\n# Test case\n${call}\n`;
  }
  const call =
    suite.target === "first-argument"
      ? `{\n  const args = [${testCase.args}];\n  ${suite.entry}(...args);\n  console.log(args[0]);\n}`
      : `console.log(${suite.entry}(${testCase.args}));`;
  return `${source.trimEnd()}\n\n// Test case\n${call}\n`;
};

export interface SuiteSummary {
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
}

export const summarize = (results: readonly TestResult[]): SuiteSummary => ({
  passed: results.filter((r) => r.status === "pass").length,
  failed: results.filter((r) => r.status !== "pass").length,
  total: results.length,
});

/** Measurements usable for the empirical complexity fit (the call ran to completion). */
export const samplesOf = (results: readonly TestResult[]): Sample[] =>
  results.flatMap((r) =>
    (r.status === "pass" || r.status === "fail") && r.inputSize !== null
      ? [{ n: r.inputSize, steps: r.steps }]
      : [],
  );
