import type { BindingId, LocId } from "./program";
import type { EncodedValue, HeapId, HeapObject } from "./values";

/**
 * Typed, compact, language-neutral execution event protocol.
 *
 * Events carry only what is needed to reconstruct runtime state: binding ids and loc ids
 * index into {@link ProgramInfo} tables, heap objects are referenced by stable ids.
 * Numeric discriminants keep structured-clone payloads small.
 */
export const EventKind = {
  /** A statement (or loop header) starts executing. Starts a step. */
  Line: 0,
  /** A function frame is entered. Starts a step. */
  Call: 1,
  /** A function frame is left (normally or by exception). Starts a step. */
  Return: 2,
  /** A binding is created (or re-created) in the current frame. */
  Declare: 3,
  /** An existing binding receives a new value. */
  Assign: 4,
  /** A single slot of a list or record is written. */
  Write: 5,
  /** A heap object is (re)captured in full, e.g. first sight or after a bulk mutation. */
  Heap: 6,
  /** A condition was evaluated. */
  Branch: 7,
  /** Bindings leave scope (block exit). */
  Drop: 8,
  /** Program output. */
  Console: 9,
  /** An exception propagates out of the current frame. */
  Throw: 10,
} as const;

export type EventKindValue = (typeof EventKind)[keyof typeof EventKind];

export type FrameId = number;

export interface LineEvent {
  readonly k: typeof EventKind.Line;
  readonly l: LocId;
}

export interface CallEvent {
  readonly k: typeof EventKind.Call;
  readonly l: LocId;
  readonly frame: FrameId;
  readonly name: string;
  /** Parameter bindings, in declaration order. */
  readonly params: ReadonlyArray<readonly [BindingId, EncodedValue]>;
}

export interface ReturnEvent {
  readonly k: typeof EventKind.Return;
  readonly l: LocId;
  readonly frame: FrameId;
  readonly value: EncodedValue;
  readonly threw: boolean;
}

export interface DeclareEvent {
  readonly k: typeof EventKind.Declare;
  readonly l: LocId;
  readonly b: BindingId;
  readonly v: EncodedValue;
}

export interface AssignEvent {
  readonly k: typeof EventKind.Assign;
  readonly l: LocId;
  readonly b: BindingId;
  readonly v: EncodedValue;
}

export interface WriteEvent {
  readonly k: typeof EventKind.Write;
  readonly l: LocId;
  readonly id: HeapId;
  /** List index (number) or record field (string). */
  readonly key: number | string;
  readonly v: EncodedValue;
}

export interface HeapEvent {
  readonly k: typeof EventKind.Heap;
  readonly o: HeapObject;
  /** Present when the capture was caused by a mutating operation in user code. */
  readonly via?: { readonly l: LocId; readonly op: string };
}

export interface BranchEvent {
  readonly k: typeof EventKind.Branch;
  readonly l: LocId;
  readonly taken: boolean;
}

export interface DropEvent {
  readonly k: typeof EventKind.Drop;
  readonly b: readonly BindingId[];
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEvent {
  readonly k: typeof EventKind.Console;
  readonly l: LocId;
  readonly level: ConsoleLevel;
  readonly text: string;
}

export interface ThrowEvent {
  readonly k: typeof EventKind.Throw;
  readonly l: LocId;
  readonly v: EncodedValue;
  readonly message: string;
}

export type TraceEvent =
  | LineEvent
  | CallEvent
  | ReturnEvent
  | DeclareEvent
  | AssignEvent
  | WriteEvent
  | HeapEvent
  | BranchEvent
  | DropEvent
  | ConsoleEvent
  | ThrowEvent;

/** Events that begin a new user-visible step in the timeline. */
export const isStepBoundary = (event: TraceEvent): boolean =>
  event.k === EventKind.Line || event.k === EventKind.Call || event.k === EventKind.Return;

/** Sentinel for events that have no meaningful source location. */
export const NO_LOC: LocId = -1;
