import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StepView } from "@/engine/core/trace/stepView";
import { InspectorProvider } from "@/features/inspector/InspectorContext";
import { ValueView } from "@/features/inspector/ValueView";
import { CORPUS } from "../corpus/programs";
import { stepViews } from "./helpers";

const render = (view: StepView, name: string): string => {
  const variable = view.frames
    .flatMap((frame) => frame.variables)
    .findLast((v) => v.name === name)!;
  return renderToStaticMarkup(
    <InspectorProvider view={view}>
      <ValueView value={variable.value} />
    </InspectorProvider>,
  );
};

const text = (html: string): string =>
  html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll(/\s+/g, " ");

describe("value primitives", () => {
  const view = stepViews(`
const arr = [3, 1, 2];
const empty = [];
const m = new Map([["a", 1], [2, "two"]]);
const s = new Set(["x", "y"]);
const point = { x: 1, nested: { deep: true } };
const big = Array.from({ length: 450 }, (_, i) => i);`).at(-1)!;

  it("draws arrays as indexed cells", () => {
    const html = render(view, "arr");
    expect(html).toContain('aria-label="index 0"');
    expect(text(html)).toContain("3 0");
    expect(text(render(view, "empty"))).toContain("empty");
  });

  it("draws maps as typed key → value rows in iteration order", () => {
    const out = text(render(view, "m"));
    expect(out).toMatch(/"a" → 1 .*2 → "two"/);
  });

  it("draws sets as unique value chips", () => {
    const out = text(render(view, "s"));
    expect(out).toContain('"x"');
    expect(out).toContain('"y"');
  });

  it("draws objects as property rows with nested groups", () => {
    const out = text(render(view, "point"));
    expect(out).toMatch(/x : 1/);
    expect(out).toMatch(/deep : true/);
  });

  it("caps large arrays and offers the rest", () => {
    const html = render(view, "big");
    expect(html.match(/aria-label="index \d+"/g)).toHaveLength(200);
    expect(text(html)).toContain("show 250 more");
  });

  it("labels recognized structures as inferred and shows pointers", () => {
    const tree = stepViews(CORPUS.treeTraversal!).at(-1)!;
    const html = render(tree, "root");
    expect(text(html)).toContain("tree · inferred");
    expect(text(html)).toContain("show as object");

    const list = stepViews(`
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }
const head = new ListNode(1, new ListNode(2));
const cur = head.next;`).at(-1)!;
    const out = text(render(list, "head"));
    expect(out).toContain("linked list · inferred");
    expect(out).toMatch(/head .*1 .*cur .*2 .*null/);
  });

  it("draws cycles as back-references instead of recursing", () => {
    const graph = stepViews(CORPUS.cyclicGraph!).at(-1)!;
    expect(render(graph, "a")).toContain("↻");
  });

  it("explains a duplicate Set.add that changed nothing", () => {
    const views = stepViews(`const s = new Set([1]);\ns.add(1);`);
    const step = views.find((v) => v.mutations.size > 0)!;
    expect(text(render(step, "s"))).toContain(
      "add() made no change — the value is already in the set",
    );
  });
});
