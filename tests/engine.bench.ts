import { MessageChannel } from "node:worker_threads";
import { Bench } from "tinybench";
import { expect, it } from "vitest";
import { TraceRecorder } from "@/engine/core/runtime/TraceRecorder";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import { decodeEvents, encodeEvents } from "@/engine/core/protocol/eventCodec";
import type { TraceEvent } from "@/engine/core/protocol/events";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";
import { JavaScriptRuntime } from "@/engine/languages/javascript/runtime/JavaScriptRuntime";
import { TEST_LIMITS } from "./helpers";

/**
 * Baselines for the pipeline stages (results recorded in docs/performance.md). Workload:
 * bubble sort of N reversed numbers — dense loops, branches and array writes.
 * Run with `pnpm bench`.
 */
const program = (n: number) => `
const a = Array.from({ length: ${n} }, (_, i) => ${n} - i);
for (let i = 0; i < a.length; i++) {
  for (let j = 0; j + 1 < a.length - i; j++) {
    if (a[j] > a[j + 1]) [a[j], a[j + 1]] = [a[j + 1], a[j]];
  }
}
console.log(a[0]);`;

const compiler = new JavaScriptCompiler("javascript", false);
const runtime = new JavaScriptRuntime("javascript");
const limits = { ...TEST_LIMITS, batchSize: 4096, maxSteps: 5_000_000, maxEvents: 5_000_000 };

const execute = (code: string): TraceEvent[] => {
  const events: TraceEvent[] = [];
  const recorder = new TraceRecorder(limits, (batch) => events.push(...batch));
  runtime.execute(code, recorder, limits);
  recorder.close();
  return events;
};

/** Latency statistics of a finished task (absent when the task errored or was aborted). */
const latencyOf = (task: Bench["tasks"][number]) =>
  task.result && "latency" in task.result ? task.result.latency : undefined;

/** The worker's batching: 4,096 events per message. */
const batchesOf = (events: TraceEvent[]): TraceEvent[][] => {
  const batches: TraceEvent[][] = [];
  for (let i = 0; i < events.length; i += 4096) batches.push(events.slice(i, i + 4096));
  return batches;
};

/**
 * Posts every batch through a real MessageChannel and resolves once all have been received
 * and turned back into events: the full cross-thread hop, measured on one thread.
 */
const pipe = (
  batches: readonly TraceEvent[][],
  send: (port: MessageChannel["port1"], batch: TraceEvent[]) => void,
  receive: (data: unknown) => TraceEvent[],
): Promise<number> => {
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve) => {
    let received = 0;
    let events = 0;
    port2.on("message", (data: unknown) => {
      events += receive(data).length;
      if (++received === batches.length) {
        port1.close();
        resolve(events);
      }
    });
    for (const batch of batches) send(port1, batch);
  });
};

const heapMb = (): number => process.memoryUsage().heapUsed / 1024 / 1024;

for (const n of [30, 100, 200]) {
  it(`bubble sort n=${n}`, async () => {
    const source = program(n);
    const compiled = compiler.compile(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const events = execute(compiled.code);
    const batches = batchesOf(events);
    const encoded = batches.map(encodeEvents);
    const encodedKb = encoded.reduce((kb, b) => kb + b.buffer.byteLength / 1024, 0);
    const strings = encoded.reduce((count, b) => count + b.strings.length, 0);

    const store = new TraceStore({ schedule: () => undefined });
    globalThis.gc?.();
    const before = heapMb();
    store.begin(1, compiled.program, source);
    store.append(1, events);
    const storeMb = heapMb() - before;
    let step = 0;

    const bench = new Bench({ time: 400 });
    bench
      .add("compile (parse + instrument)", () => void compiler.compile(source))
      .add(
        "execute without tracing",
        () => void new Function("console", source)({ log: () => undefined }),
      )
      .add("execute with tracing", () => void execute(compiled.code))
      .add("structured clone of all events", () => void structuredClone(events))
      .add("encode all events (binary)", () => void batches.map(encodeEvents))
      .add("decode all events (binary)", () => void encoded.map(decodeEvents))
      .add("postMessage: structured clone", async () => {
        await pipe(
          batches,
          (port, batch) => port.postMessage(batch),
          (data) => data as TraceEvent[],
        );
      })
      .add("postMessage: encode + transfer + decode", async () => {
        await pipe(
          batches,
          (port, batch) => {
            const message = encodeEvents(batch);
            port.postMessage(message, [message.buffer]);
          },
          (data) => decodeEvents(data as ReturnType<typeof encodeEvents>),
        );
      })
      .add("trace store ingestion + snapshots", () => {
        const fresh = new TraceStore({ schedule: () => undefined });
        fresh.begin(1, compiled.program, source);
        for (const batch of batches) fresh.append(1, batch);
      })
      .add("seek to a random step + build view", () => {
        step = (step * 7919 + 104_729) % store.stepCount;
        store.seek(step);
        store.getSnapshot();
      });
    await bench.run();

    console.log(
      `\nbubble sort n=${n}: ${events.length.toLocaleString("en-US")} events, ${store.stepCount.toLocaleString("en-US")} steps, store ≈ ${storeMb.toFixed(1)} MB heap, ` +
        `encoded ≈ ${encodedKb.toFixed(0)} KB + ${strings.toLocaleString("en-US")} table strings`,
    );
    console.table(
      bench.tasks.map((task) => ({
        stage: task.name,
        "mean (ms)": Number((latencyOf(task)?.mean ?? Number.NaN).toFixed(3)),
        "p99 (ms)": Number((latencyOf(task)?.p99 ?? Number.NaN).toFixed(3)),
      })),
    );
  });
}
