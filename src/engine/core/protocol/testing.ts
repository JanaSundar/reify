/**
 * Language-neutral test-case contracts. Arguments and expectations are written in the
 * program's own language (e.g. JavaScript expressions) and evaluated by its runtime.
 */

export interface TestCase {
  readonly id: string;
  /** Arguments as source code, e.g. `[2, 7, 11, 15], 9`. */
  readonly args: string;
  /** Expected value as source code, e.g. `[0, 1]`. */
  readonly expected: string;
}

/** What a test compares against the expectation. */
export type TestTarget = "return" | "first-argument";

export interface TestSuite {
  /** Name of the function under test. */
  readonly entry: string;
  readonly target: TestTarget;
  readonly cases: readonly TestCase[];
}

export type TestStatus = "pass" | "fail" | "error" | "limit";

export interface TestResult {
  readonly caseId: string;
  readonly status: TestStatus;
  /** Display text of the actual value, when the call returned. */
  readonly actual: string | null;
  readonly expected: string | null;
  /** Error or limit message. */
  readonly message: string | null;
  /** Operations (statements, loop checks, calls) spent inside the call under test. */
  readonly steps: number;
  /** Deepest call stack reached during the call. */
  readonly maxDepth: number;
  /** Input size `n` derived from the arguments (see docs/complexity.md). */
  readonly inputSize: number | null;
  readonly ms: number;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export const isValidEntryName = (name: string): boolean => IDENTIFIER.test(name);
