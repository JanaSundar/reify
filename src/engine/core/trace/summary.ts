import { EventKind, type TraceEvent } from "../protocol/events";
import type { BindingId, ProgramInfo } from "../protocol/program";
import type { EncodedValue, HeapId, HeapObject } from "../protocol/values";
import { previewValue } from "./describe";

export type StepEventKind =
  | "start"
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

/** One line of the execution log: the most telling event of a step. */
export interface StepSummary {
  readonly step: number;
  readonly kind: StepEventKind;
  readonly label: string;
  readonly detail: string;
  readonly line: number | null;
}

const LABEL: Record<StepEventKind, string> = {
  start: "Program start",
  line: "Line executed",
  call: "Function called",
  return: "Return value",
  declare: "Variable declared",
  assign: "Value changed",
  write: "Element written",
  mutate: "Collection changed",
  branch: "Condition evaluated",
  console: "Console output",
  throw: "Exception thrown",
};

/** Higher wins when a step contains several events. */
const PRIORITY: Partial<Record<number, number>> = {
  [EventKind.Throw]: 9,
  [EventKind.Console]: 8,
  [EventKind.Declare]: 7,
  [EventKind.Assign]: 6,
  [EventKind.Write]: 5,
  [EventKind.Heap]: 4,
  [EventKind.Call]: 3,
  [EventKind.Return]: 2,
  [EventKind.Branch]: 1,
  [EventKind.Line]: 0,
};

const name = (program: ProgramInfo, binding: BindingId): string =>
  program.bindings[binding]?.name ?? `#${binding}`;

/**
 * Summarizes a step from its own events only (no replayed state): objects captured in the
 * step are previewed in full, older references by type. Cheap enough for long logs.
 */
export const summarizeStep = (
  events: readonly TraceEvent[],
  program: ProgramInfo,
  step: number,
  /** Type name of an object captured in an earlier step, for labels like `Object#1`. */
  typeOf: (id: HeapId) => string | undefined = () => undefined,
): StepSummary => {
  const heap = new Map<HeapId, HeapObject>();
  let best: TraceEvent | null = null;
  let line: number | null = null;
  for (const event of events) {
    if (event.k === EventKind.Heap) heap.set(event.o.id, event.o);
    if (
      line === null &&
      (event.k === EventKind.Line || event.k === EventKind.Call || event.k === EventKind.Return)
    ) {
      line = program.locs[event.l]?.line ?? null;
    }
    const rank = event.k === EventKind.Heap && !event.via ? -1 : (PRIORITY[event.k] ?? -1);
    if (rank >= 0 && (best === null || rank > (PRIORITY[best.k] ?? -1))) best = event;
  }
  const show = (value: EncodedValue): string =>
    value.kind === "ref" && !heap.has(value.id)
      ? `${typeOf(value.id) ?? "object"}#${value.id}`
      : previewValue(value, heap);
  const result = (kind: StepEventKind, detail: string): StepSummary => ({
    step,
    kind,
    label: LABEL[kind],
    detail,
    line,
  });

  switch (best?.k) {
    case undefined:
    case EventKind.Drop:
      return result("start", "");
    case EventKind.Line:
      return result("line", program.locs[best.l] ? `line ${program.locs[best.l]!.line}` : "");
    case EventKind.Call:
      return result(
        "call",
        `${best.name}(${best.params.map(([b, v]) => `${name(program, b)} = ${show(v)}`).join(", ")})`,
      );
    case EventKind.Return:
      return best.threw ? result("throw", "left by exception") : result("return", show(best.value));
    case EventKind.Declare:
      return result("declare", `${name(program, best.b)} = ${show(best.v)}`);
    case EventKind.Assign:
      return result("assign", `${name(program, best.b)} = ${show(best.v)}`);
    case EventKind.Write: {
      const key = typeof best.key === "number" ? `[${best.key}]` : `.${best.key}`;
      return result("write", `${key} = ${show(best.v)}`);
    }
    case EventKind.Heap:
      return result(
        "mutate",
        `${best.via?.op ?? "update"}() → ${show({ kind: "ref", id: best.o.id })}`,
      );
    case EventKind.Branch:
      return result("branch", best.taken ? "true" : "false");
    case EventKind.Console:
      return result("console", best.text);
    case EventKind.Throw:
      return result("throw", best.message);
  }
};
