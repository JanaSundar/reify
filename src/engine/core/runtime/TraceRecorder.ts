import type { TraceEvent } from "../protocol/events";
import type { ExecutionLimits } from "../protocol/limits";
import { ResourceLimitError } from "./ResourceLimitError";

export type EventSink = (events: readonly TraceEvent[]) => void;

/**
 * Language-neutral event recorder used inside the runtime worker.
 *
 * Owns budgets (steps, events, call depth) and batching. Once any budget is exhausted the
 * recorder is poisoned: every further budget check throws again, so user `catch` blocks
 * cannot keep a runaway program alive.
 */
export class TraceRecorder {
  private buffer: TraceEvent[] = [];
  private stepCount = 0;
  private eventCount = 0;
  private depth = 0;
  private peak = 0;
  private failure: ResourceLimitError | null = null;
  private closed = false;

  /**
   * @param sink receives event batches; pass `null` to count budgets without recording
   *   events (used for test runs, where only results and operation counts matter).
   */
  constructor(
    private readonly limits: ExecutionLimits,
    private readonly sink: EventSink | null,
  ) {}

  /** False when events are not recorded; runtimes may then skip encoding work. */
  get recording(): boolean {
    return this.sink !== null;
  }

  /** Deepest call depth reached so far. */
  get peakDepth(): number {
    return this.peak;
  }

  get steps(): number {
    return this.stepCount;
  }

  get events(): number {
    return this.eventCount;
  }

  get poisoned(): ResourceLimitError | null {
    return this.failure;
  }

  /** Records one unit of execution progress and enforces the step budget. */
  step(): void {
    this.assertHealthy();
    this.stepCount += 1;
    if (this.stepCount > this.limits.maxSteps) {
      this.fail(
        new ResourceLimitError(
          "steps",
          `Execution exceeded ${this.limits.maxSteps.toLocaleString("en-US")} steps. ` +
            "Check for an infinite loop or reduce the input size.",
        ),
      );
    }
  }

  enterFrame(): void {
    this.depth += 1;
    if (this.depth > this.peak) this.peak = this.depth;
    if (this.depth > this.limits.maxCallDepth) {
      this.fail(
        new ResourceLimitError(
          "call-depth",
          `Call depth exceeded ${this.limits.maxCallDepth.toLocaleString("en-US")}. ` +
            "Check the recursion's base case.",
        ),
      );
    }
  }

  leaveFrame(): void {
    this.depth = Math.max(0, this.depth - 1);
  }

  emit(event: TraceEvent): void {
    if (this.sink === null || this.closed || this.failure !== null) return;
    if (this.eventCount >= this.limits.maxEvents) {
      this.fail(
        new ResourceLimitError(
          "events",
          `The trace exceeded ${this.limits.maxEvents.toLocaleString("en-US")} events and was truncated.`,
        ),
      );
    }
    this.eventCount += 1;
    this.buffer.push(event);
    if (this.buffer.length >= this.limits.batchSize) this.flush();
  }

  /** Re-throws the poisoning error, if any. Used at every budget checkpoint. */
  assertHealthy(): void {
    if (this.failure !== null) throw this.failure;
  }

  /** Marks the recorder as failed with a native stack overflow or similar condition. */
  fail(error: ResourceLimitError): never {
    this.failure ??= error;
    throw this.failure;
  }

  flush(): void {
    if (this.buffer.length === 0 || this.sink === null) return;
    const batch = this.buffer;
    this.buffer = [];
    this.sink(batch);
  }

  close(): void {
    this.flush();
    this.closed = true;
  }
}
