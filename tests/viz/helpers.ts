import { TraceStore } from "@/engine/core/trace/TraceStore";
import type { StepView } from "@/engine/core/trace/stepView";
import type { HeapId, HeapObject } from "@/engine/core/protocol/values";
import { trace } from "../helpers";

/** Every step view of a traced program, in order. */
export const stepViews = (source: string): StepView[] => {
  const run = trace(source);
  const store = new TraceStore({ schedule: (fn) => fn() });
  store.begin(1, run.program, source);
  store.append(1, run.events);
  store.finish(1, run.outcome, null);
  return Array.from({ length: store.stepCount }, (_, i) => {
    store.seek(i);
    return store.getSnapshot().view!;
  });
};

/** Heap object a global variable references at the given step. */
export const objectOf = (view: StepView, name: string): HeapObject => {
  const variable = view.frames.flatMap((frame) => frame.variables).findLast((v) => v.name === name);
  if (variable?.value.kind !== "ref") throw new Error(`${name} is not an object`);
  return view.heap.get(variable.value.id)!;
};

export const idOf = (view: StepView, name: string): HeapId => objectOf(view, name).id;
