import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import type { StepView } from "@/engine/core/trace/stepView";
import { CORPUS } from "../corpus/programs";
import { trace, type TracedRun } from "../helpers";

const comparable = (view: StepView | null) =>
  view && {
    loc: view.loc,
    frames: view.frames,
    closures: view.closures,
    heap: [...view.heap].toSorted(([a], [b]) => a - b),
    console: view.consoleCount,
    facts: view.facts,
  };

const makeStore = (
  run: TracedRun,
  options: ConstructorParameters<typeof TraceStore>[0],
  batch = 50,
) => {
  const store = new TraceStore({ schedule: (fn) => fn(), ...options });
  store.begin(7, run.program, "");
  for (let i = 0; i < run.events.length; i += batch)
    store.append(7, run.events.slice(i, i + batch));
  store.finish(7, run.outcome, null);
  return store;
};

const viewAt = (store: TraceStore, step: number) => {
  store.seek(step);
  return comparable(store.getSnapshot().view);
};

describe("TraceStore", () => {
  const run = trace(CORPUS.treeTraversal!);

  it("reconstructs the same state from snapshots as from a full replay", () => {
    const snapshotted = makeStore(run, { snapshotInterval: 3, maxSnapshots: 4 });
    const linear = makeStore(run, { snapshotInterval: 1e9 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: linear.stepCount - 1 }), (step) => {
        expect(viewAt(snapshotted, step)).toEqual(viewAt(linear, step));
      }),
      { numRuns: 60 },
    );
  });

  it("gives identical views when stepping backward and forward", () => {
    const store = makeStore(run, { snapshotInterval: 5 });
    const forward = Array.from({ length: store.stepCount }, (_, i) => viewAt(store, i));
    for (let i = store.stepCount - 1; i >= 0; i--) expect(viewAt(store, i)).toEqual(forward[i]);
  });

  it("clamps seeking to the recorded range", () => {
    const store = makeStore(run, {});
    store.seek(-10);
    expect(store.getSnapshot().position).toBe(0);
    store.seek(1e9);
    expect(store.getSnapshot().position).toBe(store.stepCount - 1);
  });

  it("ignores batches from stale runs", () => {
    const store = makeStore(run, {});
    const before = store.getSnapshot().totalEvents;
    store.append(6, run.events);
    store.append(8, run.events);
    expect(store.getSnapshot().totalEvents).toBe(before);
  });

  it("does not mutate recorded events or previously returned views", () => {
    const store = makeStore(trace(CORPUS.arrayMutations!), { snapshotInterval: 2 });
    store.seek(3);
    const early = JSON.stringify(comparable(store.getSnapshot().view));
    store.seek(store.stepCount - 1);
    store.seek(3);
    expect(JSON.stringify(comparable(store.getSnapshot().view))).toBe(early);
  });

  it("coalesces notifications and supports unsubscribe", () => {
    const scheduled: Array<() => void> = [];
    const store = new TraceStore({ schedule: (fn) => scheduled.push(fn) });
    const listener = vi.fn<() => void>();
    const unsubscribe = store.subscribe(listener);
    store.begin(1, run.program, "");
    store.append(1, run.events.slice(0, 10));
    store.append(1, run.events.slice(10, 20));
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.clear();
    scheduled.shift()?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().status).toBe("empty");
  });

  it("collects console output per step", () => {
    const store = makeStore(trace(CORPUS.shadowing!), {});
    const { console: lines } = store.getSnapshot();
    expect(lines.map((l) => l.text)).toEqual(["2", "1 30 1"]);
    store.seek(0);
    expect(store.getSnapshot().view?.consoleCount).toBe(0);
  });
});
