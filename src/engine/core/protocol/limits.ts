/** Resource budgets enforced while executing user code. All values are configurable. */
export interface ExecutionLimits {
  /** Maximum number of executed statements / loop checks / calls. */
  readonly maxSteps: number;
  /** Maximum number of recorded trace events. */
  readonly maxEvents: number;
  /** Maximum call depth of user functions. */
  readonly maxCallDepth: number;
  /** Wall-clock budget for execution, enforced by the coordinator (preemptive). */
  readonly timeoutMs: number;
  /** Wall-clock budget for compilation (parse + instrumentation). */
  readonly compileTimeoutMs: number;
  /** Maximum captured items per collection; the rest is reported as omitted. */
  readonly maxCollectionItems: number;
  /** Maximum heap objects captured in one encoding pass before deferring. */
  readonly maxObjectsPerCapture: number;
  /** Maximum characters of a captured string or console line. */
  readonly maxStringLength: number;
  /** Number of events sent per worker message. */
  readonly batchSize: number;
}

export const DEFAULT_LIMITS: ExecutionLimits = {
  maxSteps: 200_000,
  maxEvents: 600_000,
  maxCallDepth: 2_000,
  timeoutMs: 10_000,
  compileTimeoutMs: 8_000,
  maxCollectionItems: 1_000,
  maxObjectsPerCapture: 5_000,
  maxStringLength: 500,
  batchSize: 4_096,
};

export type LimitKind = "steps" | "events" | "call-depth" | "time";

/** How a run that produced a trace ended. */
export type RunOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "exception"; readonly message: string; readonly loc: number | null }
  | { readonly kind: "limit"; readonly limit: LimitKind; readonly message: string }
  | { readonly kind: "cancelled" };

export interface RunStats {
  readonly steps: number;
  readonly events: number;
  readonly compileMs: number;
  readonly executeMs: number;
}
