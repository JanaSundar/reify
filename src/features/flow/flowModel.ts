import { previewValue, sizedTypeName } from "@/engine/core/trace/describe";
import { variablesByObject } from "@/engine/core/trace/references";
import type { FrameView, StepView, VariableView } from "@/engine/core/trace/stepView";
import type { EncodedValue, HeapId, HeapObject } from "@/engine/core/protocol/values";
import { valueIdentity } from "@/features/viz/keys";

type Heap = ReadonlyMap<HeapId, HeapObject>;

export type ValueShape = "array" | "object" | "primitive" | "function";

/** Display type of a value: `number`, `Array(3)`, `Map(2)`, `Point`, `function`. */
export const typeLabel = (value: EncodedValue, heap: Heap): string => {
  if (value.kind === "primitive") return value.type === "other" ? "value" : value.type;
  const object = heap.get(value.id);
  if (!object) return "object";
  switch (object.kind) {
    case "list":
    case "map":
    case "set":
      return sizedTypeName(object);
    case "callable":
      return "function";
    default:
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
  /** The variable or the object it references changed in this step. */
  readonly changed: boolean;
}

export const flowVariables = (view: StepView, frame: FrameView): FlowVariable[] => {
  const owners = variablesByObject(view.frames);
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
      changed:
        variable.changed ||
        (variable.value.kind === "ref" && view.heapChanges.has(variable.value.id)),
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

/** The array cell the running call is working on. */
export interface CallTarget {
  readonly id: HeapId;
  readonly index: number;
  /** Why we know: e.g. `n = numbers[1]`. */
  readonly reason: string;
}

const isIndex = (value: EncodedValue): number | null => {
  if (value.kind !== "primitive" || value.type !== "number") return null;
  const n = Number(value.text);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * The array element the running call received, when its parameters prove it: one parameter
 * holds an index `k`, an earlier one holds exactly `array[k]` of an array visible to the
 * the flow draws, i.e. a global (the `(element, index)` shape of `map`, `forEach`, ...). A parameter
 * referencing the array itself disambiguates; anything still ambiguous returns null.
 */
export const callTarget = (view: StepView): CallTarget | null => {
  if (view.frames.length < 2) return null;
  const params = view.frames.at(-1)!.variables.filter((variable) => variable.kind === "param");
  const arrays = new Map<HeapId, string>();
  for (const variable of view.frames[0]!.variables) {
    const { value } = variable;
    if (value.kind === "ref" && view.heap.get(value.id)?.kind === "list" && !arrays.has(value.id))
      arrays.set(value.id, variable.name);
  }
  const found = new Map<string, CallTarget & { direct: boolean }>();
  params.forEach((indexParam, position) => {
    const index = isIndex(indexParam.value);
    if (index === null) return;
    for (const element of params.slice(0, position)) {
      for (const [id, name] of arrays) {
        const object = view.heap.get(id);
        const item = object?.kind === "list" ? object.items[index] : undefined;
        if (!item || valueIdentity(item) !== valueIdentity(element.value)) continue;
        found.set(`${id}:${index}`, {
          id,
          index,
          reason: `${element.name} = ${name}[${index}]`,
          direct: params.some((p) => p.value.kind === "ref" && p.value.id === id),
        });
      }
    }
  });
  const all = [...found.values()];
  const direct = all.filter((match) => match.direct);
  const pick = direct.length > 0 ? direct : all;
  if (pick.length !== 1) return null;
  const { id, index, reason } = pick[0]!;
  return { id, index, reason };
};

/** A one-sentence explanation of the step (backtick spans stripped). */
export const stepNote = (view: StepView): string => {
  const fact = view.facts.find((f) => f.kind !== "line") ?? view.facts[0];
  return fact ? fact.text.replaceAll("`", "") : "Program start";
};
