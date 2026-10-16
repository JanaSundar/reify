import type {
  Scheduler,
  WorkerFactories,
  WorkerLike,
} from "@/engine/core/coordinator/ExecutionCoordinator";

export class FakeWorker implements WorkerLike {
  readonly posted: unknown[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;

  constructor(readonly kind: "compiler" | "runtime") {}

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  /** Posted messages other than the `warm` hint every runtime worker receives first. */
  get requests(): unknown[] {
    return this.posted.filter((m) => (m as { type?: string }).type !== "warm");
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulates a message from the worker (ignored after termination, like real workers). */
  emit(data: unknown): void {
    if (!this.terminated) this.onmessage?.({ data });
  }

  crash(message: string): void {
    this.onerror?.({ message });
  }
}

export class FakeWorkers implements WorkerFactories {
  readonly created: FakeWorker[] = [];

  compiler(): WorkerLike {
    return this.make("compiler");
  }

  runtime(): WorkerLike {
    return this.make("runtime");
  }

  get compilers(): FakeWorker[] {
    return this.created.filter((w) => w.kind === "compiler");
  }

  /** Runtime workers that received an execute or test request. */
  get executing(): FakeWorker[] {
    return this.created.filter((w) => w.kind === "runtime" && w.requests.length > 0);
  }

  get runtimes(): FakeWorker[] {
    return this.created.filter((w) => w.kind === "runtime");
  }

  private make(kind: FakeWorker["kind"]): FakeWorker {
    const worker = new FakeWorker(kind);
    this.created.push(worker);
    return worker;
  }
}

export class ManualScheduler implements Scheduler {
  private time = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of this.timers) {
      if (timer.at <= this.time) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}
