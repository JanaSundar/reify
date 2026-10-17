import type { TraceRecorder } from "../core/runtime/TraceRecorder";
import type { ExecutionLimits, RunOutcome } from "../core/protocol/limits";
import type { CompileResult } from "../core/protocol/messages";
import type { TestCase, TestResult, TestSuite } from "../core/protocol/testing";

/**
 * A language plugs into the platform with two halves that run in different workers:
 *  - a compiler (long-lived worker): source → instrumented program + static tables;
 *  - a runtime (fresh worker per run): instrumented program → trace events.
 * Everything else (protocol, trace store, visualizer) is language-neutral.
 */
export interface LanguageCompiler {
  readonly languageId: string;
  compile(source: string): CompileResult;
}

export interface LanguageRuntime {
  readonly languageId: string;
  /**
   * Executes compiled code, reporting events to the recorder. Must not throw: every
   * failure is reported through the returned outcome.
   */
  execute(code: string, recorder: TraceRecorder, limits: ExecutionLimits): RunOutcome;
  /**
   * Executes a project: loads the entry module from `entryUrl`, which imports its
   * dependencies itself. Optional: only languages that support projects provide it. Must not
   * reject: every failure is reported through the returned outcome.
   */
  executeModule?(
    entryUrl: string,
    recorder: TraceRecorder,
    limits: ExecutionLimits,
  ): Promise<RunOutcome>;
  /** Runs one test case against a fresh program instance. Must not throw. */
  runTest(code: string, suite: TestSuite, testCase: TestCase, limits: ExecutionLimits): TestResult;
}
