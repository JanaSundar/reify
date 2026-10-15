import { EventKind, isStepBoundary, type ConsoleLevel, type TraceEvent } from "../protocol/events";
import type { RunOutcome, RunStats } from "../protocol/limits";
import type { ProgramInfo } from "../protocol/program";
import { applyEvent, cloneState, createInitialState, type RuntimeState } from "./state";
import { buildStepView, type StepView } from "./stepView";

export interface ConsoleLine {
  readonly step: number;
  readonly level: ConsoleLevel;
  readonly text: string;
}

export type TraceStatus = "empty" | "recording" | "complete";

/** Immutable snapshot consumed by the UI (via `useSyncExternalStore`). */
export interface TraceSnapshot {
  readonly runId: number | null;
  readonly status: TraceStatus;
  readonly program: ProgramInfo | null;
  readonly source: string;
  readonly totalSteps: number;
  readonly totalEvents: number;
  readonly position: number;
  readonly view: StepView | null;
  readonly console: readonly ConsoleLine[];
  readonly outcome: RunOutcome | null;
  readonly stats: RunStats | null;
  /** True when the recorded history is incomplete (limit, cancellation or store cap). */
  readonly truncated: boolean;
}

export interface TraceStoreOptions {
  /** Steps between snapshots initially; doubles whenever `maxSnapshots` is exceeded. */
  readonly snapshotInterval: number;
  readonly maxSnapshots: number;
  /** Hard cap on stored events (defense in depth; the worker enforces its own limit). */
  readonly maxEvents: number;
  /** Coalesces notifications (e.g. `requestAnimationFrame` in the browser). */
  readonly schedule: (callback: () => void) => void;
}

const DEFAULT_OPTIONS: TraceStoreOptions = {
  snapshotInterval: 128,
  maxSnapshots: 512,
  maxEvents: 2_000_000,
  schedule: (callback) => queueMicrotask(callback),
};

const EMPTY_SNAPSHOT: TraceSnapshot = {
  runId: null,
  status: "empty",
  program: null,
  source: "",
  totalSteps: 0,
  totalEvents: 0,
  position: 0,
  view: null,
  console: [],
  outcome: null,
  stats: null,
  truncated: false,
};

/**
 * Execution history: event log + periodic state snapshots + playback position.
 *
 * Events are folded into a live state while they arrive; every `interval` steps a copy is
 * kept. Seeking clones the nearest snapshot at or before the target and replays at most
 * `interval` steps of events, so playback never re-executes user code.
 */
export class TraceStore {
  private readonly options: TraceStoreOptions;
  private readonly listeners = new Set<() => void>();

  private runId: number | null = null;
  private program: ProgramInfo | null = null;
  private source = "";
  private status: TraceStatus = "empty";
  private events: TraceEvent[] = [];
  /** Index of the first event of every step. */
  private stepStarts: number[] = [];
  private firstBoundarySeen = false;
  private live: RuntimeState = createInitialState();
  private snapshots = new Map<number, RuntimeState>();
  private interval: number;
  private console: ConsoleLine[] = [];
  private outcome: RunOutcome | null = null;
  private stats: RunStats | null = null;
  private truncated = false;
  private position = 0;

  private cached: TraceSnapshot = EMPTY_SNAPSHOT;
  private dirty = false;
  private notifyScheduled = false;
  private viewCache: { position: number; events: number; view: StepView } | null = null;

  constructor(options: Partial<TraceStoreOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.interval = this.options.snapshotInterval;
  }

  // ---------------------------------------------------------------- subscription

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): TraceSnapshot => {
    if (this.dirty) {
      this.dirty = false;
      this.cached = this.buildSnapshot();
    }
    return this.cached;
  };

  // ---------------------------------------------------------------- ingestion

  /** Starts recording a new run; discards the previous trace. */
  begin(runId: number, program: ProgramInfo, source: string): void {
    this.reset();
    this.runId = runId;
    this.program = program;
    this.source = source;
    this.status = "recording";
    this.snapshots.set(0, cloneState(this.live));
    this.changed();
  }

  /** Appends a batch of events. Batches for any other run are ignored (stale). */
  append(runId: number, batch: readonly TraceEvent[]): void {
    if (runId !== this.runId || this.status !== "recording" || !this.program) return;
    for (const event of batch) {
      if (this.events.length >= this.options.maxEvents) {
        this.truncated = true;
        break;
      }
      this.ingest(event, this.program);
    }
    this.changed();
  }

  /** Marks the run as finished. */
  finish(runId: number, outcome: RunOutcome, stats: RunStats | null): void {
    if (runId !== this.runId || this.status !== "recording") return;
    this.status = "complete";
    this.outcome = outcome;
    this.stats = stats;
    if (outcome.kind === "limit" || outcome.kind === "cancelled") this.truncated = true;
    this.changed();
  }

  clear(): void {
    this.reset();
    this.changed();
  }

  // ---------------------------------------------------------------- playback

  get stepCount(): number {
    return this.stepStarts.length;
  }

  seek(step: number): void {
    const target = Math.max(0, Math.min(step, this.stepStarts.length - 1));
    if (target === this.position || this.stepStarts.length === 0) return;
    this.position = target;
    this.changed();
  }

  stepBy(delta: number): void {
    this.seek(this.position + delta);
  }

  // ---------------------------------------------------------------- internals

  private ingest(event: TraceEvent, program: ProgramInfo): void {
    const index = this.events.length;
    if (index === 0) this.stepStarts.push(0);
    if (isStepBoundary(event)) {
      if (!this.firstBoundarySeen) this.firstBoundarySeen = true;
      else this.startStep(index);
    }
    this.events.push(event);
    applyEvent(this.live, event, program);
    if (event.k === EventKind.Console) {
      this.console.push({ step: this.stepStarts.length - 1, level: event.level, text: event.text });
    }
  }

  private startStep(eventIndex: number): void {
    const step = this.stepStarts.push(eventIndex) - 1;
    if (step % this.interval !== 0) return;
    this.snapshots.set(step, cloneState(this.live));
    if (this.snapshots.size > this.options.maxSnapshots) this.thinSnapshots();
  }

  /** Halves snapshot density to bound memory on very long traces. */
  private thinSnapshots(): void {
    this.interval *= 2;
    for (const step of this.snapshots.keys()) {
      if (step % this.interval !== 0) this.snapshots.delete(step);
    }
  }

  private viewAt(step: number): StepView | null {
    const program = this.program;
    if (!program || this.stepStarts.length === 0) return null;
    if (
      this.viewCache &&
      this.viewCache.position === step &&
      this.viewCache.events === this.events.length
    ) {
      return this.viewCache.view;
    }
    const base = Math.floor(step / this.interval) * this.interval;
    const snapshot = this.snapshots.get(base) ?? this.snapshots.get(0)!;
    const baseStep = this.snapshots.has(base) ? base : 0;
    const state = cloneState(snapshot);
    const start = this.stepStarts[step]!;
    for (let i = this.stepStarts[baseStep]!; i < start; i++)
      applyEvent(state, this.events[i]!, program);
    const end = this.stepStarts[step + 1] ?? this.events.length;
    const view = buildStepView(state, this.events.slice(start, end), program, step);
    this.viewCache = { position: step, events: this.events.length, view };
    return view;
  }

  private buildSnapshot(): TraceSnapshot {
    if (this.status === "empty") return EMPTY_SNAPSHOT;
    return {
      runId: this.runId,
      status: this.status,
      program: this.program,
      source: this.source,
      totalSteps: this.stepStarts.length,
      totalEvents: this.events.length,
      position: this.position,
      view: this.viewAt(this.position),
      console: this.console.slice(),
      outcome: this.outcome,
      stats: this.stats,
      truncated: this.truncated,
    };
  }

  private reset(): void {
    this.runId = null;
    this.program = null;
    this.source = "";
    this.status = "empty";
    this.events = [];
    this.stepStarts = [];
    this.firstBoundarySeen = false;
    this.live = createInitialState();
    this.snapshots = new Map();
    this.interval = this.options.snapshotInterval;
    this.console = [];
    this.outcome = null;
    this.stats = null;
    this.truncated = false;
    this.position = 0;
    this.viewCache = null;
  }

  private changed(): void {
    this.dirty = true;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    this.options.schedule(() => {
      this.notifyScheduled = false;
      for (const listener of this.listeners) listener();
    });
  }
}
