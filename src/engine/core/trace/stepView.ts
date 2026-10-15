import { EventKind, isStepBoundary, type FrameId, type TraceEvent } from "../protocol/events";
import type { BindingId, BindingKind, LocInfo, ProgramInfo } from "../protocol/program";
import type { EncodedValue, HeapId, HeapObject } from "../protocol/values";
import { previewValue } from "./describe";
import { applyEvent, frameHolding, readBinding, type RuntimeState } from "./state";

export interface VariableView {
  readonly binding: BindingId;
  readonly name: string;
  readonly kind: BindingKind;
  readonly value: EncodedValue;
  /** Value before this step, when it changed during the step. */
  readonly previous: EncodedValue | null;
  readonly changed: boolean;
}

export interface FrameView {
  readonly id: FrameId;
  readonly name: string;
  readonly callLoc: LocInfo | null;
  readonly variables: readonly VariableView[];
}

/** Heap slots touched in this step: `all` when the object was (re)captured as a whole. */
export type HeapChange = "all" | ReadonlySet<number | string>;

export type FactKind =
  | "line"
  | "call"
  | "return"
  | "declare"
  | "assign"
  | "write"
  | "mutate"
  | "branch"
  | "console"
  | "throw";

/** A deterministic runtime fact about a step (no interpretation, no AI). */
export interface Fact {
  readonly kind: FactKind;
  readonly text: string;
}

export type StepKind = "start" | "line" | "call" | "return";

export interface StepView {
  readonly index: number;
  readonly kind: StepKind;
  readonly loc: LocInfo | null;
  /** Call stack, outermost (global) first. */
  readonly frames: readonly FrameView[];
  readonly closures: readonly VariableView[];
  readonly heap: ReadonlyMap<HeapId, HeapObject>;
  readonly heapChanges: ReadonlyMap<HeapId, HeapChange>;
  readonly consoleCount: number;
  readonly facts: readonly Fact[];
}

const stepKindOf = (event: TraceEvent | undefined): StepKind => {
  switch (event?.k) {
    case EventKind.Line:
      return "line";
    case EventKind.Call:
      return "call";
    case EventKind.Return:
      return "return";
    default:
      return "start";
  }
};

const changeKey = (frame: FrameId | "closure", binding: BindingId): string => `${frame}:${binding}`;

const locOf = (program: ProgramInfo, id: number): LocInfo | null =>
  id >= 0 ? (program.locs[id] ?? null) : null;

/** Name of a variable referencing a heap object (innermost frame first), else its type. */
const objectLabel = (state: RuntimeState, program: ProgramInfo, id: HeapId): string => {
  for (let i = state.frames.length - 1; i >= 0; i--) {
    for (const [binding, value] of state.frames[i]!.vars) {
      if (value.kind === "ref" && value.id === id) return bindingName(program, binding);
    }
  }
  return state.heap.get(id)?.typeName ?? "object";
};

const bindingName = (program: ProgramInfo, binding: BindingId): string =>
  program.bindings[binding]?.name ?? `#${binding}`;

/**
 * Applies the events of one step to `state` (a private working copy positioned at the
 * start of the step) and derives an immutable view of the result.
 */
export const buildStepView = (
  state: RuntimeState,
  events: readonly TraceEvent[],
  program: ProgramInfo,
  index: number,
): StepView => {
  const previous = new Map<string, EncodedValue | null>();
  const heapChanges = new Map<HeapId, HeapChange>();
  const facts: Fact[] = [];
  const show = (value: EncodedValue): string => previewValue(value, state.heap);
  const label = (id: HeapId): string => objectLabel(state, program, id);

  for (const event of events) {
    if (event.k === EventKind.Declare || event.k === EventKind.Assign) {
      const holder = event.k === EventKind.Declare ? null : frameHolding(state, event.b);
      const frameId =
        event.k === EventKind.Declare ? state.frames.at(-1)!.id : (holder?.id ?? "closure");
      const key = changeKey(frameId, event.b);
      if (!previous.has(key)) {
        previous.set(
          key,
          event.k === EventKind.Assign ? (readBinding(state, event.b) ?? null) : null,
        );
      }
    }
    if (event.k === EventKind.Write) {
      const current = heapChanges.get(event.id);
      if (current !== "all") heapChanges.set(event.id, new Set([...(current ?? []), event.key]));
    }
    if (event.k === EventKind.Heap && event.via) heapChanges.set(event.o.id, "all");

    applyEvent(state, event, program);
    const fact = describeEvent(event, program, show, label);
    if (fact) facts.push(fact);
  }

  const variableView = (
    frame: FrameId | "closure",
    binding: BindingId,
    value: EncodedValue,
  ): VariableView => {
    const key = changeKey(frame, binding);
    const info = program.bindings[binding];
    return {
      binding,
      name: info?.name ?? `#${binding}`,
      kind: info?.kind ?? "var",
      value,
      previous: previous.get(key) ?? null,
      changed: previous.has(key),
    };
  };

  // The first step may begin with set-up events (hoisted declarations) before its line.
  const boundary = events.find(isStepBoundary);
  return {
    index,
    kind: stepKindOf(boundary),
    loc: boundary && "l" in boundary ? locOf(program, boundary.l) : null,
    frames: state.frames.map((frame) => ({
      id: frame.id,
      name: frame.name,
      callLoc: frame.callLoc === null ? null : locOf(program, frame.callLoc),
      variables: [...frame.vars].map(([binding, value]) => variableView(frame.id, binding, value)),
    })),
    closures: [...state.closures].map(([binding, value]) =>
      variableView("closure", binding, value),
    ),
    heap: state.heap,
    heapChanges,
    consoleCount: state.consoleCount,
    facts,
  };
};

/** One factual sentence per meaningful event. */
const describeEvent = (
  event: TraceEvent,
  program: ProgramInfo,
  show: (value: EncodedValue) => string,
  label: (id: HeapId) => string,
): Fact | null => {
  switch (event.k) {
    case EventKind.Line: {
      const loc = locOf(program, event.l);
      if (!loc) return null;
      const reads =
        loc.reads.length > 0 ? ` — reads ${loc.reads.map((r) => `\`${r}\``).join(", ")}` : "";
      return { kind: "line", text: `Executes line ${loc.line}${reads}` };
    }
    case EventKind.Call: {
      const args = event.params
        .map(([b, v]) => `${bindingName(program, b)} = ${show(v)}`)
        .join(", ");
      return { kind: "call", text: `Calls \`${event.name}(${args})\`` };
    }
    case EventKind.Return:
      return event.threw
        ? { kind: "return", text: "Leaves the function because of an exception" }
        : { kind: "return", text: `Returns ${show(event.value)}` };
    case EventKind.Declare:
      return {
        kind: "declare",
        text: `Declares \`${bindingName(program, event.b)}\` = ${show(event.v)}`,
      };
    case EventKind.Assign:
      return {
        kind: "assign",
        text: `Sets \`${bindingName(program, event.b)}\` to ${show(event.v)}`,
      };
    case EventKind.Write:
      return {
        kind: "write",
        text: `Sets \`${label(event.id)}${typeof event.key === "number" ? `[${event.key}]` : `.${event.key}`}\` to ${show(event.v)}`,
      };
    case EventKind.Heap:
      return event.via
        ? {
            kind: "mutate",
            text: `\`${label(event.o.id)}.${event.via.op}()\` → ${show({ kind: "ref", id: event.o.id })}`,
          }
        : null;
    case EventKind.Branch: {
      const loc = locOf(program, event.l);
      const where = loc ? ` on line ${loc.line}` : "";
      return { kind: "branch", text: `Condition${where} is ${event.taken ? "true" : "false"}` };
    }
    case EventKind.Console:
      return { kind: "console", text: `Prints: ${event.text}` };
    case EventKind.Throw:
      return { kind: "throw", text: `Throws ${event.message}` };
    case EventKind.Drop:
      return null;
  }
};
