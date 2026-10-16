import { describe, expect, it } from "vitest";
import type { StepView } from "@/engine/core/trace/stepView";
import { changesOf, entryKey } from "@/features/viz/changes";
import { primitive } from "@/engine/core/protocol/values";
import { objectOf, stepViews } from "./helpers";

const changesAt = (view: StepView, name: string) => {
  const object = objectOf(view, name);
  return changesOf(object, view.mutations.get(object.id), view.heapChanges.get(object.id));
};

/** First step whose facts mention `text`. */
const stepWith = (views: StepView[], text: string): StepView =>
  views.find((view) => view.facts.some((fact) => fact.text.includes(text)))!;

describe("changesOf", () => {
  it("reports a rejected Set.add as a mutation with no change", () => {
    const views = stepViews(`
const seen = new Set([1, 2]);
seen.add(3);
seen.add(2);`);
    const added = views.filter((view) => view.mutations.size > 0);
    expect(added).toHaveLength(2);
    const first = changesAt(added[0]!, "seen");
    expect(first.entries.get(entryKey(primitive("number", "3")))).toBe("added");
    expect(first.unchanged).toBe(false);
    const duplicate = changesAt(added[1]!, "seen");
    expect(duplicate.unchanged).toBe(true);
    expect(duplicate.op).toBe("add");
  });

  it("distinguishes inserted, updated and deleted map entries", () => {
    const views = stepViews(`
const m = new Map([["a", 1]]);
m.set("b", 2);
m.set("a", 5);
m.delete("b");
m.delete("zzz");`);
    const mutated = views.filter((view) => view.mutations.size > 0).map((v) => changesAt(v, "m"));
    const a = entryKey(primitive("string", '"a"'));
    const b = entryKey(primitive("string", '"b"'));
    expect(mutated[0]!.entries.get(b)).toBe("added");
    expect(mutated[1]!.entries.get(a)).toBe("updated");
    expect(mutated[2]!.removed).toBe(1);
    expect(mutated[3]!.unchanged).toBe(true);
  });

  it("marks written list slots and new object fields", () => {
    const views = stepViews(`
const arr = [1, 2, 3];
arr[1] = 2;
arr[2] = 9;
const o = { x: 1 };
o.y = 2;`);
    expect(changesAt(stepWith(views, "arr[1]"), "arr").entries.get("1")).toBe("updated");
    expect(changesAt(stepWith(views, "arr[2]"), "arr").entries.get("2")).toBe("updated");
    expect(changesAt(stepWith(views, "o.y"), "o").entries.get("y")).toBe("added");
  });

  it("does not treat a freshly declared literal as a change", () => {
    const views = stepViews(`const arr = [1, 2];`);
    const last = views.at(-1)!;
    expect(changesAt(last, "arr").entries.size).toBe(0);
  });
});
