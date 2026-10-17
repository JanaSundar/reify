import type { EncodedEvents } from "./eventCodec";
import type { ExecutionLimits, RunOutcome } from "./limits";
import type { CompletionResult, HoverInfo } from "./languageService";
import type { Project } from "../project/types";
import type { Diagnostic, ProgramInfo } from "./program";
import type { TestResult, TestSuite } from "./testing";

/**
 * Typed message protocol between the main thread and the two worker kinds:
 *  - the long-lived compiler worker (parse + instrument), and
 *  - a fresh runtime worker per run (execute instrumented code, stream events).
 * Every message carries the run id so stale results can be rejected.
 */

export interface CompileRequest {
  readonly type: "compile";
  readonly runId: number;
  readonly languageId: string;
  /** The program's source; for a project, the entry file's. */
  readonly source: string;
  /** Present for a multi-file run: every file, compiled as native modules. */
  readonly project?: Project;
}

export type CompileResult =
  | {
      readonly ok: true;
      /** The instrumented program; empty for a project, whose modules are published instead. */
      readonly code: string;
      readonly program: ProgramInfo;
      /** Where a project's entry module is served from. */
      readonly entryUrl?: string;
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface CompileResponse {
  readonly type: "compiled";
  readonly runId: number;
  readonly result: CompileResult;
  readonly compileMs: number;
}

export interface ExecuteRequest {
  readonly type: "execute";
  readonly runId: number;
  readonly languageId: string;
  readonly code: string;
  /** Runs the project whose entry module is served at this url, instead of `code`. */
  readonly entryUrl?: string;
  readonly limits: ExecutionLimits;
}

export interface TestRequest {
  readonly type: "test";
  readonly runId: number;
  readonly languageId: string;
  readonly code: string;
  readonly suite: TestSuite;
  readonly limits: ExecutionLimits;
}

/**
 * Sent to a worker ahead of a run so it loads the language's compiler (compiler worker) or
 * runtime (a spare runtime worker) while it waits. Carries no run id: it is not part of a run.
 */
export interface WarmRequest {
  readonly type: "warm";
  readonly languageId: string;
}

/** One editor question for a language service that lives in the compiler worker. */
export type ServiceCall =
  | { readonly method: "diagnostics" }
  | { readonly method: "complete"; readonly pos: number; readonly explicit: boolean }
  | { readonly method: "hover"; readonly pos: number };

/** Carries the whole document, so a replaced worker needs no state handed over. */
export interface ServiceRequest {
  readonly type: "service";
  readonly id: number;
  readonly languageId: string;
  readonly source: string;
  readonly call: ServiceCall;
}

/** `result` is `null` when the language has no service or the call failed. */
export interface ServiceResponse {
  readonly type: "service-result";
  readonly id: number;
  readonly result: readonly Diagnostic[] | CompletionResult | HoverInfo | null;
}

/** The worker has loaded the run's language compiler or runtime and starts working. */
export interface ReadyMessage {
  readonly type: "ready";
  readonly runId: number;
}

export interface TestResultMessage {
  readonly type: "test-result";
  readonly runId: number;
  readonly result: TestResult;
}

/** A batch of trace events, binary-encoded so its buffer can be transferred (zero copy). */
export interface EventsMessage {
  readonly type: "events";
  readonly runId: number;
  readonly batch: EncodedEvents;
}

export interface DoneMessage {
  readonly type: "done";
  readonly runId: number;
  readonly outcome: RunOutcome;
  readonly steps: number;
  readonly events: number;
  readonly executeMs: number;
}

export interface WorkerFailureMessage {
  readonly type: "failure";
  readonly runId: number;
  readonly message: string;
}

export type CompilerWorkerMessage = ReadyMessage | CompileResponse | WorkerFailureMessage;
export type RuntimeRequest = ExecuteRequest | TestRequest;
export type RuntimeWorkerMessage =
  | ReadyMessage
  | EventsMessage
  | TestResultMessage
  | DoneMessage
  | WorkerFailureMessage;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasRunId = (value: Record<string, unknown>): boolean =>
  typeof value.runId === "number" && Number.isInteger(value.runId);

/** Shallow structural validation; malformed messages are dropped, never trusted. */
const isProject = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.entry === "string" &&
  Array.isArray(value.files) &&
  value.files.every(
    (file) => isObject(file) && typeof file.path === "string" && typeof file.source === "string",
  );

export const parseCompileRequest = (data: unknown): CompileRequest | null =>
  isObject(data) &&
  data.type === "compile" &&
  hasRunId(data) &&
  typeof data.languageId === "string" &&
  typeof data.source === "string" &&
  (data.project === undefined || isProject(data.project))
    ? (data as unknown as CompileRequest)
    : null;

export const parseExecuteRequest = (data: unknown): ExecuteRequest | null =>
  isObject(data) &&
  data.type === "execute" &&
  hasRunId(data) &&
  typeof data.languageId === "string" &&
  typeof data.code === "string" &&
  (data.entryUrl === undefined || typeof data.entryUrl === "string") &&
  isObject(data.limits)
    ? (data as unknown as ExecuteRequest)
    : null;

const isTestSuite = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.entry === "string" &&
  (value.target === "return" || value.target === "first-argument") &&
  Array.isArray(value.cases) &&
  value.cases.every(
    (c) =>
      isObject(c) &&
      typeof c.id === "string" &&
      typeof c.args === "string" &&
      typeof c.expected === "string",
  );

const isServiceCall = (value: unknown): value is ServiceCall =>
  isObject(value) &&
  (value.method === "diagnostics" ||
    (value.method === "complete" &&
      typeof value.pos === "number" &&
      typeof value.explicit === "boolean") ||
    (value.method === "hover" && typeof value.pos === "number"));

export const parseServiceRequest = (data: unknown): ServiceRequest | null =>
  isObject(data) &&
  data.type === "service" &&
  typeof data.id === "number" &&
  typeof data.languageId === "string" &&
  typeof data.source === "string" &&
  isServiceCall(data.call)
    ? (data as unknown as ServiceRequest)
    : null;

export const parseServiceResponse = (data: unknown): ServiceResponse | null =>
  isObject(data) && data.type === "service-result" && typeof data.id === "number"
    ? (data as unknown as ServiceResponse)
    : null;

export const parseWarmRequest = (data: unknown): WarmRequest | null =>
  isObject(data) && data.type === "warm" && typeof data.languageId === "string"
    ? (data as unknown as WarmRequest)
    : null;

/** Validates either kind of runtime-worker request. */
export const parseRuntimeRequest = (data: unknown): RuntimeRequest | null => {
  const execute = parseExecuteRequest(data);
  if (execute) return execute;
  return isObject(data) &&
    data.type === "test" &&
    hasRunId(data) &&
    typeof data.languageId === "string" &&
    typeof data.code === "string" &&
    isTestSuite(data.suite) &&
    isObject(data.limits)
    ? (data as unknown as TestRequest)
    : null;
};

export const parseCompilerMessage = (data: unknown): CompilerWorkerMessage | null => {
  if (!isObject(data) || !hasRunId(data)) return null;
  if (data.type === "ready") return data as unknown as ReadyMessage;
  if (data.type === "compiled" && isObject(data.result) && typeof data.result.ok === "boolean") {
    return data as unknown as CompileResponse;
  }
  if (data.type === "failure" && typeof data.message === "string") {
    return data as unknown as WorkerFailureMessage;
  }
  return null;
};

export const parseRuntimeMessage = (data: unknown): RuntimeWorkerMessage | null => {
  if (!isObject(data) || !hasRunId(data)) return null;
  switch (data.type) {
    case "ready":
      return data as unknown as ReadyMessage;
    case "events":
      return isObject(data.batch) &&
        data.batch.buffer instanceof ArrayBuffer &&
        Array.isArray(data.batch.strings)
        ? (data as unknown as EventsMessage)
        : null;
    case "test-result":
      return isObject(data.result) &&
        typeof data.result.caseId === "string" &&
        typeof data.result.status === "string"
        ? (data as unknown as TestResultMessage)
        : null;
    case "done":
      return isObject(data.outcome) && typeof data.outcome.kind === "string"
        ? (data as unknown as DoneMessage)
        : null;
    case "failure":
      return typeof data.message === "string" ? (data as unknown as WorkerFailureMessage) : null;
    default:
      return null;
  }
};
