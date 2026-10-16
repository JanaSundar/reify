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
  /**
   * Wall-clock budget for a runtime worker to load its language runtime (Pyodide downloads
   * several megabytes on first use). The execution budget starts once it is loaded.
   */
  readonly loadTimeoutMs: number;
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
  loadTimeoutMs: 30_000,
  compileTimeoutMs: 8_000,
  maxCollectionItems: 1_000,
  maxObjectsPerCapture: 5_000,
  maxStringLength: 500,
  batchSize: 4_096,
};

export type LimitKind = "steps" | "events" | "call-depth" | "time";

const count = (n: number): string => n.toLocaleString("en-US");

/** What the user is told when a budget runs out (the same for every language). */
export const limitMessage = (kind: LimitKind, limits: ExecutionLimits): string => {
  switch (kind) {
    case "steps":
      return (
        `Execution exceeded ${count(limits.maxSteps)} steps. ` +
        "Check for an infinite loop or reduce the input size."
      );
    case "call-depth":
      return `Call depth exceeded ${count(limits.maxCallDepth)}. Check the recursion's base case.`;
    case "events":
      return `The trace exceeded ${count(limits.maxEvents)} events and was truncated.`;
    case "time":
      return `Execution took longer than ${limits.timeoutMs / 1000} s and was stopped.`;
  }
};

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
