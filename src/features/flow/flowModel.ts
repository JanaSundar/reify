import { previewValue } from "@/engine/core/trace/describe";
import type { FrameView, StepView, VariableView } from "@/engine/core/trace/stepView";
import type { EncodedValue, HeapId, HeapObject } from "@/engine/core/protocol/values";

type Heap = ReadonlyMap<HeapId, HeapObject>;

export type ValueShape = "array" | "object" | "primitive" | "function";

/** Display type of a value: `number`, `Array(3)`, `Map(2)`, `Point`, `function`. */
export const typeLabel = (value: EncodedValue, heap: Heap): string => {
  if (value.kind === "primitive") return value.type === "other" ? "value" : value.type;
  const object = heap.get(value.id);
  if (!object) return "object";
  switch (object.kind) {
    case "list":
      return `Array(${object.items.length + (object.omitted ?? 0)})`;
    case "map":
    case "set":
      return `${object.typeName}(${(object.kind === "map" ? object.entries.length : object.items.length) + (object.omitted ?? 0)})`;
    case "record":
      return "Object";
    case "instance":
      return object.typeName;
    case "callable":
      return "function";
    case "opaque":
      return object.typeName;
  }
};

export const shapeOf = (value: EncodedValue, heap: Heap): ValueShape => {
  if (value.kind === "primitive") return "primitive";
  const object = heap.get(value.id);
  if (object?.kind === "callable") return "function";
  if (object?.kind === "list" && object.items.every((item) => item.kind === "primitive"))
    return "array";
  return "object";
};

/** A variable prepared for drawing. */
export interface FlowVariable {
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly shape: ValueShape;
  readonly preview: string;
  readonly variable: VariableView;
  /** Other variable names pointing at the same object (aliasing). */
  readonly sharedWith: readonly string[];
  /** List indices written in this step. */
  readonly changedCells: readonly number[];
  /** Item previews, for arrays of primitives. */
  readonly cells: readonly string[];
}

const MAX_CELLS = 64;

const cellsOf = (value: EncodedValue, heap: Heap): string[] => {
  const object = value.kind === "ref" ? heap.get(value.id) : undefined;
  return object?.kind === "list"
    ? object.items.slice(0, MAX_CELLS).map((item) => previewValue(item, heap))
    : [];
};

const changedCells = (view: StepView, value: EncodedValue): number[] => {
  if (value.kind !== "ref") return [];
  const change = view.heapChanges.get(value.id);
  if (!change) return [];
  if (change === "all") return [];
  return [...change].filter((key): key is number => typeof key === "number");
};

const refOwners = (view: StepView): Map<HeapId, string[]> => {
  const owners = new Map<HeapId, string[]>();
  for (const frame of view.frames) {
    for (const variable of frame.variables) {
      if (variable.value.kind !== "ref") continue;
      owners.set(variable.value.id, [...(owners.get(variable.value.id) ?? []), variable.name]);
    }
  }
  return owners;
};

export const flowVariables = (view: StepView, frame: FrameView): FlowVariable[] => {
  const owners = refOwners(view);
  return frame.variables
    .filter((variable) => shapeOf(variable.value, view.heap) !== "function")
    .map((variable) => ({
      key: `${frame.id}:${variable.binding}`,
      name: variable.name,
      type: typeLabel(variable.value, view.heap),
      shape: shapeOf(variable.value, view.heap),
      preview: previewValue(variable.value, view.heap),
      variable,
      sharedWith:
        variable.value.kind === "ref"
          ? (owners.get(variable.value.id) ?? []).filter((name) => name !== variable.name)
          : [],
      changedCells: changedCells(view, variable.value),
      cells: cellsOf(variable.value, view.heap),
    }));
};

/** The call currently running, e.g. `anonymous(n = 2, i = 0)`, or null at top level. */
export const activeCall = (view: StepView): string | null => {
  const frame = view.frames.at(-1);
  if (!frame || view.frames.length < 2) return null;
  const params = frame.variables
    .filter((variable) => variable.kind === "param")
    .map((variable) => `${variable.name} = ${previewValue(variable.value, view.heap)}`);
  return `${frame.name}(${params.join(", ")})`;
};

/** A one-sentence explanation of the step (backtick spans stripped). */
export const stepNote = (view: StepView): string => {
  const fact = view.facts.find((f) => f.kind !== "line") ?? view.facts[0];
  return fact ? fact.text.replaceAll("`", "") : "Program start";
};
