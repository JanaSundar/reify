import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import {
  ExecutionCoordinator,
  type RunCallbacks,
} from "@/engine/core/coordinator/ExecutionCoordinator";
import { encodeEvents } from "@/engine/core/protocol/eventCodec";
import type { TraceEvent } from "@/engine/core/protocol/events";
import { DEFAULT_LIMITS } from "@/engine/core/protocol/limits";
import type { ProgramInfo } from "@/engine/core/protocol/program";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import { createExecutionActor, executionMachine, statusOf } from "@/machine/executionMachine";
import { FakeWorkers, ManualScheduler, type FakeWorker } from "./fakes";

const PROGRAM: ProgramInfo = {
  languageId: "javascript",
  locs: [{ line: 1, column: 0, endLine: 1, endColumn: 5, role: "statement", reads: [] }],
  bindings: [],
  warnings: [],
  complexity: null,
};

const setup = () => {
  const workers = new FakeWorkers();
  const scheduler = new ManualScheduler();
  const store = new TraceStore({ schedule: (fn) => fn() });
  const coordinator = new ExecutionCoordinator(workers, store, DEFAULT_LIMITS, scheduler);
  const callbacks: RunCallbacks = {
    onProgress: vi.fn<RunCallbacks["onProgress"]>(),
    onCompiled: vi.fn<RunCallbacks["onCompiled"]>(),
    onTestResult: vi.fn<RunCallbacks["onTestResult"]>(),
    onComplete: vi.fn<RunCallbacks["onComplete"]>(),
    onError: vi.fn<RunCallbacks["onError"]>(),
    onCancelled: vi.fn<RunCallbacks["onCancelled"]>(),
  };
  return { workers, scheduler, store, coordinator, callbacks };
};

const compiled = (compiler: FakeWorker, runId: number) =>
  compiler.emit({
    type: "compiled",
    runId,
    compileMs: 1,
    result: { ok: true, code: "", program: PROGRAM },
  });

const line: TraceEvent = { k: 0, l: 0 };
const batch = (...events: TraceEvent[]) => encodeEvents(events);

describe("ExecutionCoordinator", () => {
  it("compiles, executes in a fresh worker and records the trace", () => {
    const { workers, store, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    compiled(workers.compilers[0]!, 1);
    const runtime = workers.executing[0]!;
    expect(runtime.posted[0]).toMatchObject({ type: "execute", runId: 1 });
    runtime.emit({ type: "events", runId: 1, batch: batch(line, line) });
    runtime.emit({
      type: "done",
      runId: 1,
      outcome: { kind: "ok" },
      steps: 2,
      events: 2,
      executeMs: 1,
    });
    expect(callbacks.onComplete).toHaveBeenCalledWith(
      { kind: "ok" },
      expect.objectContaining({ steps: 2 }),
    );
    expect(runtime.terminated).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "complete", totalSteps: 2 });
  });

  it("reports compile diagnostics without starting a runtime", () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    const diagnostics = [{ severity: "error", code: "syntax", message: "bad", range: null }];
    workers.compilers[0]!.emit({
      type: "compiled",
      runId: 1,
      compileMs: 1,
      result: { ok: false, diagnostics },
    });
    expect(callbacks.onError).toHaveBeenCalledWith({ kind: "compile", diagnostics });
    expect(workers.executing).toHaveLength(0);
  });

  it("rejects stale and malformed messages", () => {
    const { workers, store, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    coordinator.start({ runId: 2, languageId: "javascript", source: "y" }, callbacks);
    const compiler = workers.compilers[0]!;
    compiled(compiler, 1); // stale
    expect(workers.executing).toHaveLength(0);
    compiler.emit({ type: "compiled", runId: "2" });
    compiler.emit(null);
    compiled(compiler, 2);
    const runtime = workers.executing[0]!;
    runtime.emit({ type: "events", runId: 1, batch: batch(line) });
    runtime.emit({ type: "events", runId: 2, batch: "nope" });
    expect(store.getSnapshot().totalEvents).toBe(0);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it("fails the run on a malformed event batch", () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    compiled(workers.compilers[0]!, 1);
    const runtime = workers.executing[0]!;
    runtime.emit({ type: "events", runId: 1, batch: { buffer: new ArrayBuffer(4), strings: [] } });
    expect(runtime.terminated).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledWith({
      kind: "internal",
      message: expect.stringContaining("Malformed trace batch"),
    });
  });

  it("supersedes an overlapping run and terminates its worker", () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    compiled(workers.compilers[0]!, 1);
    const first = workers.executing[0]!;
    coordinator.start({ runId: 2, languageId: "javascript", source: "y" }, callbacks);
    expect(first.terminated).toBe(true);
    first.emit({
      type: "done",
      runId: 1,
      outcome: { kind: "ok" },
      steps: 0,
      events: 0,
      executeMs: 0,
    });
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it("cancels by terminating the runtime and keeps the partial trace", () => {
    const { workers, store, coordinator, callbacks } = setup();
    const handle = coordinator.start(
      { runId: 1, languageId: "javascript", source: "x" },
      callbacks,
    );
    compiled(workers.compilers[0]!, 1);
    workers.executing[0]!.emit({ type: "events", runId: 1, batch: batch(line, line, line) });
    handle.cancel();
    expect(workers.executing[0]!.terminated).toBe(true);
    expect(callbacks.onCancelled).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({
      status: "complete",
      truncated: true,
      totalSteps: 3,
      outcome: { kind: "cancelled" },
    });
  });

  it("stops runaway execution at the wall-clock timeout", () => {
    const { workers, scheduler, store, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    compiled(workers.compilers[0]!, 1);
    scheduler.advance(DEFAULT_LIMITS.timeoutMs + 1);
    expect(workers.executing[0]!.terminated).toBe(true);
    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "limit", limit: "time" }),
      expect.anything(),
    );
    expect(store.getSnapshot().truncated).toBe(true);
  });

  it("replaces a stuck compiler after the compile timeout", () => {
    const { workers, scheduler, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    scheduler.advance(DEFAULT_LIMITS.compileTimeoutMs + 1);
    expect(workers.compilers[0]!.terminated).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "internal" }));
    coordinator.start({ runId: 2, languageId: "javascript", source: "x" }, callbacks);
    expect(workers.compilers).toHaveLength(2);
  });

  it("reports worker crashes as failures", () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    compiled(workers.compilers[0]!, 1);
    workers.executing[0]!.crash("out of memory");
    expect(callbacks.onError).toHaveBeenCalledWith({
      kind: "internal",
      message: expect.stringContaining("out of memory"),
    });
  });

  it("uses the prewarmed runtime worker", () => {
    const { workers, coordinator, callbacks } = setup();
    coordinator.prewarm();
    const spare = workers.created.find((w) => w.kind === "runtime")!;
    coordinator.start({ runId: 1, languageId: "javascript", source: "x" }, callbacks);
    compiled(workers.compilers[0]!, 1);
    expect(spare.posted).toHaveLength(1);
  });
});

const startMachine = () => {
  const env = setup();
  const actor = createActor(
    executionMachine.provide({
      actors: { execution: createExecutionActor(env.coordinator) },
      actions: { clearTrace: () => env.store.clear() },
    }),
  ).start();
  const status = () => statusOf(actor.getSnapshot().value);
  return { ...env, actor, status };
};

describe("execution machine", () => {
  it("walks idle → running → completed with a fresh run id", () => {
    const { actor, workers, status } = startMachine();
    expect(status()).toBe("idle");
    actor.send({ type: "RUN", source: "x", languageId: "javascript" });
    expect(status()).toBe("running");
    const { runId } = actor.getSnapshot().context;
    expect(runId).toBe(1);
    compiled(workers.compilers[0]!, runId);
    workers.executing[0]!.emit({
      type: "done",
      runId,
      outcome: { kind: "ok" },
      steps: 0,
      events: 0,
      executeMs: 0,
    });
    expect(status()).toBe("completed");
    expect(actor.getSnapshot().context.outcome).toEqual({ kind: "ok" });
  });

  it("ignores illegal transitions", () => {
    const { actor, status } = startMachine();
    actor.send({ type: "CANCEL" });
    expect(status()).toBe("idle");
    actor.send({
      type: "EXECUTION_COMPLETE",
      runId: 0,
      outcome: { kind: "ok" },
      stats: { steps: 0, events: 0, compileMs: 0, executeMs: 0 },
    });
    expect(status()).toBe("idle");
  });

  it("cancels through cancelling → cancelled", () => {
    const { actor, workers, status } = startMachine();
    actor.send({ type: "RUN", source: "while(true){}", languageId: "javascript" });
    compiled(workers.compilers[0]!, 1);
    actor.send({ type: "CANCEL" });
    expect(status()).toBe("cancelled");
    expect(workers.executing[0]!.terminated).toBe(true);
  });

  it("restarts cleanly when RUN arrives during a run", () => {
    const { actor, workers, status } = startMachine();
    actor.send({ type: "RUN", source: "a", languageId: "javascript" });
    compiled(workers.compilers[0]!, 1);
    const first = workers.executing[0]!;
    actor.send({ type: "RUN", source: "b", languageId: "javascript" });
    expect(first.terminated).toBe(true);
    expect(actor.getSnapshot().context.runId).toBe(2);
    // A late message from run 1 must not complete run 2.
    actor.send({
      type: "EXECUTION_COMPLETE",
      runId: 1,
      outcome: { kind: "ok" },
      stats: { steps: 0, events: 0, compileMs: 0, executeMs: 0 },
    });
    expect(status()).toBe("running");
  });

  it("moves to failed on compile errors and back to running on RUN", () => {
    const { actor, workers, status } = startMachine();
    actor.send({ type: "RUN", source: "let x = ;", languageId: "javascript" });
    workers.compilers[0]!.emit({
      type: "compiled",
      runId: 1,
      compileMs: 0,
      result: { ok: false, diagnostics: [] },
    });
    expect(status()).toBe("failed");
    expect(actor.getSnapshot().context.failure).toEqual({ kind: "compile", diagnostics: [] });
    actor.send({ type: "RUN", source: "1", languageId: "javascript" });
    expect(status()).toBe("running");
  });

  it("RESET stops the run and clears the trace", () => {
    const { actor, workers, store, status } = startMachine();
    actor.send({ type: "RUN", source: "a", languageId: "javascript" });
    compiled(workers.compilers[0]!, 1);
    workers.executing[0]!.emit({ type: "events", runId: 1, batch: batch(line) });
    actor.send({ type: "RESET" });
    expect(status()).toBe("idle");
    expect(workers.executing[0]!.terminated).toBe(true);
    expect(store.getSnapshot().status).toBe("empty");
  });
});

describe("test runs", () => {
  const suite = {
    entry: "f",
    target: "return" as const,
    cases: [{ id: "a", args: "1", expected: "1" }],
  };
  const result = {
    caseId: "a",
    status: "pass" as const,
    actual: "1",
    expected: "1",
    message: null,
    steps: 3,
    maxDepth: 1,
    inputSize: 1,
    ms: 0,
  };

  it("sends a test request, streams results into the machine and leaves the trace alone", () => {
    const { actor, workers, store, status } = startMachine();
    actor.send({
      type: "RUN",
      source: "function f(x) { return x; }",
      languageId: "javascript",
      suite,
    });
    compiled(workers.compilers[0]!, 1);
    const runtime = workers.executing[0]!;
    expect(runtime.posted[0]).toMatchObject({ type: "test", runId: 1, suite });
    runtime.emit({ type: "test-result", runId: 1, result });
    runtime.emit({ type: "test-result", runId: 99, result: { ...result, caseId: "stale" } });
    runtime.emit({
      type: "done",
      runId: 1,
      outcome: { kind: "ok" },
      steps: 3,
      events: 0,
      executeMs: 1,
    });
    expect(status()).toBe("completed");
    expect(actor.getSnapshot().context.testResults).toEqual([result]);
    expect(store.getSnapshot().status).toBe("empty");
  });

  it("keeps test results while a single case is traced", () => {
    const { actor, workers } = startMachine();
    actor.send({ type: "RUN", source: "x", languageId: "javascript", suite });
    compiled(workers.compilers[0]!, 1);
    workers.executing[0]!.emit({ type: "test-result", runId: 1, result });
    actor.send({ type: "RUN", source: "x", languageId: "javascript" });
    expect(actor.getSnapshot().context.testResults).toEqual([result]);
  });
});
