import type { PyodideAPI } from "pyodide";
import {
  limitMessage,
  type ExecutionLimits,
  type LimitKind,
  type RunOutcome,
} from "../../../core/protocol/limits";
import type { TestCase, TestResult, TestSuite } from "../../../core/protocol/testing";
import type { TraceRecorder } from "../../../core/runtime/TraceRecorder";
import type { LanguageRuntime } from "../../types";
import { installPythonModule, installReifyProtocol, loadPyodideRuntime } from "../pyodide";
import { decodePythonEvents } from "./pythonEvents";
import TRACER from "./reify_tracer.py?raw";

type PythonOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "exception"; readonly message: string; readonly loc: number | null }
  | { readonly kind: "limit"; readonly limit: LimitKind };

type ExecuteFn = (code: string, flush: (batch: string) => void, limits: string) => string;
type RunTestFn = (
  code: string,
  entry: string,
  target: string,
  args: string,
  expected: string,
  limits: string,
) => string;

type PythonTestFields = Omit<TestResult, "caseId" | "message" | "ms"> & {
  readonly message: string | null;
  readonly limit?: LimitKind;
  readonly ms?: number;
};

const toOutcome = (outcome: PythonOutcome, limits: ExecutionLimits): RunOutcome =>
  outcome.kind === "limit"
    ? { kind: "limit", limit: outcome.limit, message: limitMessage(outcome.limit, limits) }
    : outcome;

/**
 * Executes instrumented Python on Pyodide with `reify_tracer.py`. The tracer enforces the
 * step, event and call-depth budgets inside Python (so `except` cannot swallow them) and
 * streams event batches, which are decoded here and fed to the recorder.
 */
export class PythonRuntime implements LanguageRuntime {
  private constructor(
    readonly languageId: string,
    private readonly executeFn: ExecuteFn,
    private readonly runTestFn: RunTestFn,
  ) {}

  /** Loads Pyodide in the worker and prepares it (see `create`). */
  static async load(languageId: string): Promise<PythonRuntime> {
    return PythonRuntime.create(languageId, await loadPyodideRuntime());
  }

  /**
   * Installs the tracer into a loaded Pyodide and locks the interpreter down. Pyodide is
   * passed in so tests can use Node's.
   */
  static create(languageId: string, pyodide: PyodideAPI): PythonRuntime {
    installReifyProtocol(pyodide);
    const tracer = installPythonModule(pyodide, "reify_tracer", TRACER);
    const execute = tracer.execute as ExecuteFn;
    const runTest = tracer.run_test as RunTestFn;
    (tracer.lock_down as () => void)();
    return new PythonRuntime(languageId, execute, runTest);
  }

  execute(code: string, recorder: TraceRecorder, limits: ExecutionLimits): RunOutcome {
    const flush = (batch: string) => {
      // The tracer enforces the same event budget, so the recorder never refuses an event;
      // a JS exception must not surface inside Python, where user code could catch it.
      try {
        for (const event of decodePythonEvents(batch)) recorder.emit(event);
      } catch {
        // dropped: the run is ending with a limit outcome anyway
      }
    };
    let result: { outcome: PythonOutcome; steps: number };
    try {
      result = JSON.parse(this.executeFn(code, flush, JSON.stringify(limits)));
    } catch (error) {
      return { kind: "exception", message: `Python runtime error: ${String(error)}`, loc: null };
    }
    recorder.addSteps(result.steps);
    return toOutcome(result.outcome, limits);
  }

  runTest(code: string, suite: TestSuite, testCase: TestCase, limits: ExecutionLimits): TestResult {
    const base = { caseId: testCase.id, actual: null, expected: null, steps: 0, maxDepth: 0 };
    if (!testCase.expected.trim())
      return {
        ...base,
        status: "error",
        message: "Enter the expected value.",
        inputSize: null,
        ms: 0,
      };
    let fields: PythonTestFields;
    try {
      fields = JSON.parse(
        this.runTestFn(
          code,
          suite.entry,
          suite.target,
          testCase.args,
          testCase.expected,
          JSON.stringify(limits),
        ),
      );
    } catch (error) {
      return {
        ...base,
        status: "error",
        message: `Python runtime error: ${String(error)}`,
        inputSize: null,
        ms: 0,
      };
    }
    const { limit, ms, ...rest } = fields;
    return {
      ...rest,
      caseId: testCase.id,
      message: limit ? limitMessage(limit, limits) : rest.message,
      ms: ms ?? 0,
    };
  }
}
