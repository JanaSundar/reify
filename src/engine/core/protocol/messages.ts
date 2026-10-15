import type { EncodedEvents } from "./eventCodec";
import type { ExecutionLimits, RunOutcome } from "./limits";
import type { Diagnostic, ProgramInfo } from "./program";

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
  readonly source: string;
}

export type CompileResult =
  | { readonly ok: true; readonly code: string; readonly program: ProgramInfo }
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
  readonly limits: ExecutionLimits;
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

export type CompilerWorkerMessage = CompileResponse | WorkerFailureMessage;
export type RuntimeWorkerMessage = EventsMessage | DoneMessage | WorkerFailureMessage;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasRunId = (value: Record<string, unknown>): boolean =>
  typeof value.runId === "number" && Number.isInteger(value.runId);

/** Shallow structural validation; malformed messages are dropped, never trusted. */
export const parseCompileRequest = (data: unknown): CompileRequest | null =>
  isObject(data) &&
  data.type === "compile" &&
  hasRunId(data) &&
  typeof data.languageId === "string" &&
  typeof data.source === "string"
    ? (data as unknown as CompileRequest)
    : null;

export const parseExecuteRequest = (data: unknown): ExecuteRequest | null =>
  isObject(data) &&
  data.type === "execute" &&
  hasRunId(data) &&
  typeof data.languageId === "string" &&
  typeof data.code === "string" &&
  isObject(data.limits)
    ? (data as unknown as ExecuteRequest)
    : null;

export const parseCompilerMessage = (data: unknown): CompilerWorkerMessage | null => {
  if (!isObject(data) || !hasRunId(data)) return null;
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
    case "events":
      return isObject(data.batch) &&
        data.batch.buffer instanceof ArrayBuffer &&
        Array.isArray(data.batch.strings)
        ? (data as unknown as EventsMessage)
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
