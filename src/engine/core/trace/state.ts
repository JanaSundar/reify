import { EventKind, type FrameId, type TraceEvent } from "../protocol/events";
import type { BindingId, LocId, ProgramInfo } from "../protocol/program";
import {
  cloneHeapObject,
  type EncodedValue,
  type HeapId,
  type HeapObject,
} from "../protocol/values";

export interface FrameState {
  readonly id: FrameId;
  readonly name: string;
  readonly callLoc: LocId | null;
  /** Insertion-ordered bindings visible in this frame. */
  readonly vars: Map<BindingId, EncodedValue>;
}

/**
 * Reconstructed runtime state. Instances are working copies: `applyEvent` mutates the
 * state it is given, and callers clone before handing a state to anyone else.
 */
export interface RuntimeState {
  readonly frames: FrameState[];
  readonly heap: Map<HeapId, HeapObject>;
  /** Variables of frames that are no longer on the stack but still reachable by closures. */
  readonly closures: Map<BindingId, EncodedValue>;
  consoleCount: number;
}

export const GLOBAL_FRAME_ID: FrameId = 0;

export const createInitialState = (): RuntimeState => ({
  frames: [{ id: GLOBAL_FRAME_ID, name: "global", callLoc: null, vars: new Map() }],
  heap: new Map(),
  closures: new Map(),
  consoleCount: 0,
});

/** Copies the mutable parts of a state. Heap objects are copied because writes mutate them. */
export const cloneState = (state: RuntimeState): RuntimeState => ({
  frames: state.frames.map((frame) => ({ ...frame, vars: new Map(frame.vars) })),
  heap: new Map([...state.heap].map(([id, object]) => [id, cloneHeapObject(object)])),
  closures: new Map(state.closures),
  consoleCount: state.consoleCount,
});

/** Finds the innermost frame that holds a binding (top of stack first). */
export const frameHolding = (state: RuntimeState, binding: BindingId): FrameState | undefined => {
  for (let i = state.frames.length - 1; i >= 0; i--) {
    const frame = state.frames[i]!;
    if (frame.vars.has(binding)) return frame;
  }
  return undefined;
};

/** Current value of a binding, wherever it lives. */
export const readBinding = (state: RuntimeState, binding: BindingId): EncodedValue | undefined =>
  frameHolding(state, binding)?.vars.get(binding) ?? state.closures.get(binding);

const topFrame = (state: RuntimeState): FrameState => state.frames[state.frames.length - 1]!;

const writeSlot = (object: HeapObject, key: number | string, value: EncodedValue): void => {
  if (object.kind === "list" && typeof key === "number") {
    while (object.items.length < key)
      object.items.push({ kind: "primitive", type: "other", text: "empty" });
    object.items[key] = value;
  } else if ((object.kind === "record" || object.kind === "instance") && typeof key === "string") {
    const index = object.fields.findIndex(([name]) => name === key);
    if (index >= 0) object.fields[index] = [key, value];
    else object.fields.push([key, value]);
  }
};

/**
 * Applies one event to a working state (in place). Pure with respect to everything except
 * `state`; events are never mutated.
 */
export const applyEvent = (state: RuntimeState, event: TraceEvent, program: ProgramInfo): void => {
  switch (event.k) {
    case EventKind.Call:
      state.frames.push({
        id: event.frame,
        name: event.name,
        callLoc: event.l,
        vars: new Map(event.params),
      });
      return;
    case EventKind.Return: {
      const top = topFrame(state);
      if (top.id !== event.frame || state.frames.length === 1) return;
      state.frames.pop();
      return;
    }
    case EventKind.Declare:
      topFrame(state).vars.set(event.b, event.v);
      return;
    case EventKind.Assign: {
      const holder = frameHolding(state, event.b);
      if (holder) holder.vars.set(event.b, event.v);
      else if (program.bindings[event.b]?.kind === "global")
        state.frames[0]!.vars.set(event.b, event.v);
      else state.closures.set(event.b, event.v);
      return;
    }
    case EventKind.Drop: {
      const top = topFrame(state);
      for (const binding of event.b) top.vars.delete(binding);
      return;
    }
    case EventKind.Write: {
      const object = state.heap.get(event.id);
      if (object) writeSlot(object, event.key, event.v);
      return;
    }
    case EventKind.Heap:
      state.heap.set(event.o.id, cloneHeapObject(event.o));
      return;
    case EventKind.Console:
      state.consoleCount += 1;
      return;
    case EventKind.Line:
    case EventKind.Branch:
    case EventKind.Throw:
      return;
  }
};
