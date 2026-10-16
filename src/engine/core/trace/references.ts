import type { HeapId } from "../protocol/values";
import { childValues } from "../protocol/values";
import type { FrameView, StepView } from "./stepView";

/** Names of the variables in `frames` that reference each heap object (unique, in order). */
export const variablesByObject = (frames: readonly FrameView[]): Map<HeapId, string[]> => {
  const names = new Map<HeapId, string[]>();
  for (const frame of frames) {
    for (const variable of frame.variables) {
      if (variable.value.kind !== "ref") continue;
      const list = names.get(variable.value.id) ?? [];
      if (!list.includes(variable.name)) list.push(variable.name);
      names.set(variable.value.id, list);
    }
  }
  return names;
};

/** The frames whose variables are on screen: the global frame and the running one. */
export const visibleFrames = (view: StepView): readonly FrameView[] =>
  view.frames.length > 1 ? [view.frames[0]!, view.frames.at(-1)!] : view.frames;

/** How many references point at each object, from variables, closures and other objects. */
export const inboundReferences = (view: StepView): Map<HeapId, number> => {
  const counts = new Map<HeapId, number>();
  const values = [
    ...view.frames.flatMap((frame) => frame.variables.map((variable) => variable.value)),
    ...view.closures.map((variable) => variable.value),
    ...[...view.heap.values()].flatMap(childValues),
  ];
  for (const value of values) {
    if (value.kind === "ref") counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
  }
  return counts;
};
