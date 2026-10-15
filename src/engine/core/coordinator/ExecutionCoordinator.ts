import { decodeEvents } from "../protocol/eventCodec";
import type { TraceEvent } from "../protocol/events";
import {
  parseCompilerMessage,
  parseRuntimeMessage,
  type CompileRequest,
  type CompileResponse,
  type RuntimeRequest,
  type RuntimeWorkerMessage,
} from "../protocol/messages";
import {
  DEFAULT_LIMITS,
  type ExecutionLimits,
  type RunOutcome,
  type RunStats,
} from "../protocol/limits";
import type { Diagnostic, ProgramInfo } from "../protocol/program";
import type { TestResult, TestSuite } from "../protocol/testing";
import type { TraceStore } from "../trace/TraceStore";

/** The subset of `Worker` the coordinator relies on (fakes implement it in tests). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface WorkerFactories {
  /** Long-lived worker that compiles source code. */
  compiler(): WorkerLike;
  /** Single-use worker that executes one program. */
  runtime(): WorkerLike;
}

export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const browserScheduler: Scheduler = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  now: () => performance.now(),
};

export interface RunRequest {
  readonly runId: number;
  readonly languageId: string;
  readonly source: string;
  /** When present, the run executes these test cases instead of recording a trace. */
  readonly suite?: TestSuite;
}

export type RunPhase = "compiling" | "executing";

export interface RunProgress {
  readonly phase: RunPhase;
  readonly steps: number;
  readonly events: number;
}

/** Failures that produce no usable trace. */
export type RunFailure =
  | { readonly kind: "compile"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "internal"; readonly message: string };

export interface RunCallbacks {
  onProgress(progress: RunProgress): void;
  /** The program compiled; its static information (e.g. complexity) is available. */
  onCompiled(program: ProgramInfo): void;
  onTestResult(result: TestResult): void;
  onComplete(outcome: RunOutcome, stats: RunStats): void;
  onError(failure: RunFailure): void;
  onCancelled(): void;
}

export interface RunHandle {
  /** Stops the run and reports `onCancelled`; the partial trace stays playable. */
  cancel(): void;
  /** Stops the run silently (used when the run is superseded or the owner goes away). */
  dispose(): void;
}

interface ActiveRun {
  readonly request: RunRequest;
  readonly callbacks: RunCallbacks;
  phase: RunPhase;
  runtime: WorkerLike | null;
  timer: unknown;
  compileMs: number;
  events: number;
  lastProgressAt: number;
  traceStarted: boolean;
}

const PROGRESS_INTERVAL_MS = 100;

/**
 * Orchestrates one run at a time across the compiler worker, a fresh runtime worker and
 * the trace store. Owns run ids' validity: messages for anything but the active run are
 * dropped. Cancellation and timeouts terminate the runtime worker, which is preemptive
 * even for `while (true) {}`.
 */
export class ExecutionCoordinator {
  private compiler: WorkerLike | null = null;
  private spareRuntime: WorkerLike | null = null;
  private active: ActiveRun | null = null;

  constructor(
    private readonly workers: WorkerFactories,
    private readonly store: TraceStore,
    private readonly limits: ExecutionLimits = DEFAULT_LIMITS,
    private readonly scheduler: Scheduler = browserScheduler,
  ) {}

  /** Starts workers ahead of time so the first run does not pay their start-up cost. */
  prewarm(): void {
    this.ensureCompiler();
    this.spareRuntime ??= this.workers.runtime();
  }

  start(request: RunRequest, callbacks: RunCallbacks): RunHandle {
    if (this.active) this.stop(this.active);
    const run: ActiveRun = {
      request,
      callbacks,
      phase: "compiling",
      runtime: null,
      timer: null,
      compileMs: 0,
      events: 0,
      lastProgressAt: 0,
      traceStarted: false,
    };
    this.active = run;
    run.timer = this.scheduler.setTimeout(() => this.onTimeout(run), this.limits.compileTimeoutMs);
    callbacks.onProgress({ phase: "compiling", steps: 0, events: 0 });
    const message: CompileRequest = {
      type: "compile",
      runId: request.runId,
      languageId: request.languageId,
      source: request.source,
    };
    this.ensureCompiler().postMessage(message);
    return {
      cancel: () => this.cancel(run),
      dispose: () => {
        if (this.active === run) this.stop(run);
      },
    };
  }

  /** Terminates every worker. The coordinator can still be used afterwards. */
  dispose(): void {
    if (this.active) this.stop(this.active);
    this.compiler?.terminate();
    this.compiler = null;
    this.spareRuntime?.terminate();
    this.spareRuntime = null;
  }

  // ---------------------------------------------------------------- compile phase

  private ensureCompiler(): WorkerLike {
    if (this.compiler) return this.compiler;
    const worker = this.workers.compiler();
    worker.onmessage = (event) => this.onCompilerMessage(event.data);
    worker.onerror = (event) => {
      this.compiler?.terminate();
      this.compiler = null;
      const run = this.active;
      if (run?.phase === "compiling")
        this.fail(run, `Compiler worker failed: ${event.message ?? "unknown error"}`);
    };
    this.compiler = worker;
    return worker;
  }

  private onCompilerMessage(data: unknown): void {
    const message = parseCompilerMessage(data);
    const run = this.active;
    if (!message || !run || message.runId !== run.request.runId || run.phase !== "compiling")
      return;
    if (message.type === "failure") {
      this.fail(run, message.message);
      return;
    }
    this.onCompiled(run, message);
  }

  private onCompiled(run: ActiveRun, message: CompileResponse): void {
    const { result } = message;
    run.compileMs = message.compileMs;
    if (!result.ok) {
      this.finishRun(run);
      run.callbacks.onError({ kind: "compile", diagnostics: result.diagnostics });
      return;
    }
    run.callbacks.onCompiled(result.program);
    if (!run.request.suite) {
      this.store.begin(run.request.runId, result.program, run.request.source);
      run.traceStarted = true;
    }
    this.execute(run, result.code);
  }

  // ---------------------------------------------------------------- execute phase

  private execute(run: ActiveRun, code: string): void {
    run.phase = "executing";
    this.scheduler.clearTimeout(run.timer);
    run.timer = this.scheduler.setTimeout(() => this.onTimeout(run), this.limits.timeoutMs);

    const worker = this.spareRuntime ?? this.workers.runtime();
    this.spareRuntime = null;
    run.runtime = worker;
    worker.onmessage = (event) => this.onRuntimeMessage(run, event.data);
    worker.onerror = (event) =>
      this.fail(run, `Execution worker failed: ${event.message ?? "unknown error"}`);

    const { runId, languageId, suite } = run.request;
    const request: RuntimeRequest = suite
      ? { type: "test", runId, languageId, code, suite, limits: this.limits }
      : { type: "execute", runId, languageId, code, limits: this.limits };
    worker.postMessage(request);
    run.callbacks.onProgress({ phase: "executing", steps: 0, events: 0 });
    // Warm the next runtime worker while this one executes.
    this.spareRuntime = this.workers.runtime();
  }

  private onRuntimeMessage(run: ActiveRun, data: unknown): void {
    if (this.active !== run) return;
    const message: RuntimeWorkerMessage | null = parseRuntimeMessage(data);
    if (!message || message.runId !== run.request.runId) return;

    switch (message.type) {
      case "events": {
        let events: TraceEvent[];
        try {
          events = decodeEvents(message.batch);
        } catch (error) {
          this.fail(run, `Malformed trace batch: ${(error as Error).message}`);
          return;
        }
        this.store.append(run.request.runId, events);
        run.events += events.length;
        this.reportProgress(run);
        return;
      }
      case "test-result":
        run.callbacks.onTestResult(message.result);
        return;
      case "done": {
        if (run.traceStarted) {
          this.store.finish(
            run.request.runId,
            message.outcome,
            this.statsOf(run, message.steps, message.executeMs),
          );
        }
        this.finishRun(run);
        run.callbacks.onComplete(
          message.outcome,
          this.statsOf(run, message.steps, message.executeMs),
        );
        return;
      }
      case "failure":
        this.fail(run, message.message);
        return;
    }
  }

  private reportProgress(run: ActiveRun): void {
    const now = this.scheduler.now();
    if (now - run.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    run.lastProgressAt = now;
    run.callbacks.onProgress({
      phase: "executing",
      steps: this.store.stepCount,
      events: run.events,
    });
  }

  private statsOf(run: ActiveRun, steps: number, executeMs: number): RunStats {
    return { steps, events: run.events, compileMs: run.compileMs, executeMs };
  }

  // ---------------------------------------------------------------- termination

  private cancel(run: ActiveRun): void {
    if (this.active !== run) return;
    if (run.traceStarted) this.store.finish(run.request.runId, { kind: "cancelled" }, null);
    this.finishRun(run);
    run.callbacks.onCancelled();
  }

  private onTimeout(run: ActiveRun): void {
    if (this.active !== run) return;
    if (run.phase === "compiling") {
      // A stuck compiler is replaced; the next run gets a fresh one.
      this.compiler?.terminate();
      this.compiler = null;
      this.fail(run, `Compilation took longer than ${this.limits.compileTimeoutMs} ms.`);
      return;
    }
    const outcome: RunOutcome = {
      kind: "limit",
      limit: "time",
      message: `Execution took longer than ${this.limits.timeoutMs / 1000} s and was stopped.`,
    };
    const stats = this.statsOf(run, this.store.stepCount, this.limits.timeoutMs);
    if (run.traceStarted) this.store.finish(run.request.runId, outcome, stats);
    this.finishRun(run);
    run.callbacks.onComplete(outcome, stats);
  }

  private fail(run: ActiveRun, message: string): void {
    if (this.active !== run) return;
    if (run.traceStarted) {
      this.store.finish(run.request.runId, { kind: "exception", message, loc: null }, null);
    }
    this.finishRun(run);
    run.callbacks.onError({ kind: "internal", message });
  }

  /** Stops a run without reporting anything (superseded or disposed). */
  private stop(run: ActiveRun): void {
    if (run.traceStarted) this.store.finish(run.request.runId, { kind: "cancelled" }, null);
    this.finishRun(run);
  }

  private finishRun(run: ActiveRun): void {
    this.scheduler.clearTimeout(run.timer);
    if (run.runtime) {
      run.runtime.onmessage = null;
      run.runtime.onerror = null;
      run.runtime.terminate();
      run.runtime = null;
    }
    if (this.active === run) this.active = null;
  }
}
