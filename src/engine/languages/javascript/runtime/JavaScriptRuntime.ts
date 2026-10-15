import type { ExecutionLimits, RunOutcome } from "../../../core/protocol/limits";
import {
  isValidEntryName,
  type TestCase,
  type TestResult,
  type TestSuite,
} from "../../../core/protocol/testing";
import { TraceRecorder } from "../../../core/runtime/TraceRecorder";
import type { LanguageRuntime } from "../../types";
import { CONSOLE_PARAM, TRACER_PARAM } from "../traceApi";
import { deepEqual, measureInputSize } from "./jsCompare";
import { JsTracer } from "./JsTracer";
import { describeThrown, formatValue } from "./jsValues";

type Program<T> = (tracer: JsTracer, console: JsTracer["console"]) => T;

interface Harness {
  readonly fn: ((...args: unknown[]) => unknown) | undefined;
  readonly args: () => unknown[];
  readonly expected: () => unknown;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Executes instrumented JavaScript (sloppy-mode script semantics) with a tracer. */
export class JavaScriptRuntime implements LanguageRuntime {
  constructor(readonly languageId: string) {}

  execute(code: string, recorder: TraceRecorder, limits: ExecutionLimits): RunOutcome {
    const tracer = new JsTracer(recorder, limits);
    let program: Program<unknown>;
    try {
      program = new Function(TRACER_PARAM, CONSOLE_PARAM, code) as Program<unknown>;
    } catch (error) {
      return { kind: "exception", message: `Could not load program: ${String(error)}`, loc: null };
    }
    try {
      program(tracer, tracer.console);
      return { kind: "ok" };
    } catch (error) {
      const limit = tracer.limitFor(error);
      if (limit) return { kind: "limit", limit: limit.limit, message: limit.message };
      const message = tracer.uncaught(error);
      return { kind: "exception", message, loc: tracer.currentLoc >= 0 ? tracer.currentLoc : null };
    }
  }

  /**
   * Runs one test case in a fresh program instance (so cases cannot leak state into each
   * other). Budgets apply; events are not recorded. Arguments and the expectation are
   * evaluated in the program's scope, so they may use the program's own helpers.
   */
  runTest(code: string, suite: TestSuite, testCase: TestCase, limits: ExecutionLimits): TestResult {
    const recorder = new TraceRecorder(limits, null);
    const tracer = new JsTracer(recorder, limits);
    const result = (fields: Partial<TestResult>): TestResult => ({
      caseId: testCase.id,
      status: "error",
      actual: null,
      expected: null,
      message: null,
      steps: 0,
      maxDepth: recorder.peakDepth,
      inputSize: null,
      ms: 0,
      ...fields,
    });
    const failure = (error: unknown, context: string): TestResult => {
      const limit = tracer.limitFor(error);
      return limit
        ? result({ status: "limit", message: limit.message })
        : result({ message: `${context}${describeThrown(error)}` });
    };

    if (!isValidEntryName(suite.entry))
      return result({ message: `“${suite.entry}” is not a valid function name.` });
    if (!testCase.expected.trim()) return result({ message: "Enter the expected value." });

    let program: Program<Harness>;
    try {
      program = new Function(
        TRACER_PARAM,
        CONSOLE_PARAM,
        `${code}\n;return { fn: typeof ${suite.entry} === "function" ? ${suite.entry} : undefined, ` +
          `args: () => [${testCase.args}\n], expected: () => (${testCase.expected}\n) };`,
      ) as Program<Harness>;
    } catch (error) {
      return result({ message: `This test case is not valid JavaScript: ${errorMessage(error)}` });
    }

    let harness: Harness;
    try {
      harness = program(tracer, tracer.console);
    } catch (error) {
      return failure(error, "The program threw before the test ran: ");
    }
    if (!harness.fn) return result({ message: `No function named “${suite.entry}” was found.` });

    let args: unknown[];
    let expected: unknown;
    try {
      args = harness.args();
      expected = harness.expected();
    } catch (error) {
      return failure(error, "Evaluating the test case threw: ");
    }
    const inputSize = measureInputSize(args);
    const expectedText = formatValue(expected, 1, limits.maxStringLength);

    const stepsBefore = recorder.steps;
    const started = performance.now();
    let returned: unknown;
    try {
      returned = harness.fn(...args);
    } catch (error) {
      return {
        ...failure(error, ""),
        steps: recorder.steps - stepsBefore,
        inputSize,
        expected: expectedText,
      };
    }
    const actual = suite.target === "first-argument" ? args[0] : returned;
    return result({
      status: deepEqual(actual, expected) ? "pass" : "fail",
      actual: formatValue(actual, 1, limits.maxStringLength),
      expected: expectedText,
      steps: recorder.steps - stepsBefore,
      maxDepth: recorder.peakDepth,
      inputSize,
      ms: performance.now() - started,
    });
  }
}
