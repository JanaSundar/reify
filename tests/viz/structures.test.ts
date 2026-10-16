import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  layoutTree,
  nodeValue,
  recognizeStructure,
  type LinkedListShape,
  type TreeShape,
} from "@/features/viz/structures";
import { CORPUS } from "../corpus/programs";
import { idOf, stepViews } from "./helpers";

const lastView = (source: string) => stepViews(source).at(-1)!;

describe("recognizeStructure", () => {
  it("recognizes a linked list built from class instances", () => {
    const view = lastView(`
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }
const head = new ListNode(1, new ListNode(2, new ListNode(3)));`);
    const shape = recognizeStructure(view.heap, idOf(view, "head"));
    expect(shape?.kind).toBe("linked-list");
    expect((shape as LinkedListShape).nodes.map((id) => nodeValue(view.heap, id)?.text)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect((shape as LinkedListShape).cycleTo).toBeNull();
    expect((shape as LinkedListShape).end).toBe("null");
  });

  it("stops at a cycle instead of traversing forever", () => {
    const view = lastView(`
class ListNode { constructor(val) { this.val = val; this.next = null; } }
const a = new ListNode(1); const b = new ListNode(2); const c = new ListNode(3);
a.next = b; b.next = c; c.next = b;`);
    const shape = recognizeStructure(view.heap, idOf(view, "a"));
    expect(shape).toMatchObject({ kind: "linked-list", cycleTo: idOf(view, "b") });
    expect((shape as LinkedListShape).nodes).toHaveLength(3);
  });

  it("recognizes the corpus binary search tree", () => {
    const view = lastView(CORPUS.treeTraversal!);
    const shape = recognizeStructure(view.heap, idOf(view, "root"));
    expect(shape?.kind).toBe("tree");
    expect((shape as TreeShape).children.size).toBe(6);
  });

  it("falls back for ambiguous shapes", () => {
    // Nodes with differing fields that point at each other (corpus cyclic graph).
    const graph = lastView(CORPUS.cyclicGraph!);
    expect(recognizeStructure(graph.heap, idOf(graph, "a"))).toBeNull();
    // A shared child makes a DAG, not a tree.
    const dag = lastView(`
const leaf = { v: 3, left: null, right: null };
const root = { v: 1, left: { v: 2, left: leaf, right: null }, right: leaf };`);
    expect(recognizeStructure(dag.heap, idOf(dag, "root"))).toBeNull();
    // A lone object with a next field and a non-suggestive name is just an object.
    const lone = lastView(`const step = { at: 1, next: null };`);
    expect(recognizeStructure(lone.heap, idOf(lone, "step"))).toBeNull();
    // Ordinary nested objects are not trees.
    const nested = lastView(`const user = { name: "a", address: { city: "b" } };`);
    expect(recognizeStructure(nested.heap, idOf(nested, "user"))).toBeNull();
  });
});

/** Layout violations: overlapping nodes in a row, or children on the wrong side. */
const violations = (
  layout: ReturnType<typeof layoutTree>,
  children: TreeShape["children"],
): string[] => {
  const problems: string[] = [];
  const x = new Map(layout.nodes.map((node) => [node.id, node.x]));
  for (const row of Map.groupBy(layout.nodes, (node) => node.y).values()) {
    const xs = row.map((node) => node.x).toSorted((a, b) => a - b);
    for (let i = 1; i < xs.length; i++)
      if (xs[i]! - xs[i - 1]! < 1) problems.push(`overlap at ${xs[i]}`);
  }
  for (const [parent, [left, right]] of children) {
    if (left != null && x.get(left)! >= x.get(parent)!) problems.push(`left of ${parent}`);
    if (right != null && x.get(right)! <= x.get(parent)!) problems.push(`right of ${parent}`);
  }
  if (Math.min(...x.values()) < 0) problems.push("negative x");
  return problems;
};

describe("layoutTree", () => {
  const view = lastView(CORPUS.treeTraversal!);
  const shape = recognizeStructure(view.heap, idOf(view, "root")) as TreeShape;

  it("places each node once, without overlaps, children on their side", () => {
    const layout = layoutTree(shape);
    expect(layout.nodes).toHaveLength(6);
    expect(violations(layout, shape.children)).toEqual([]);
  });

  it("does the same for random binary search trees", () => {
    type Node = { id: number; v: number; left: Node | null; right: Node | null };
    const insert = (root: Node | null, v: number, id: number): Node => {
      if (!root) return { id, v, left: null, right: null };
      if (v < root.v) root.left = insert(root.left, v, id);
      else root.right = insert(root.right, v, id);
      return root;
    };
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { minLength: 1, maxLength: 40 }),
        (values) => {
          const root = values.reduce<Node | null>((tree, v, i) => insert(tree, v, i), null)!;
          const children = new Map<number, Array<number | null>>();
          const walk = (node: Node | null): void => {
            if (!node) return;
            children.set(node.id, [node.left?.id ?? null, node.right?.id ?? null]);
            walk(node.left);
            walk(node.right);
          };
          walk(root);
          const layout = layoutTree({ kind: "tree", root: root.id, children, binary: true });
          expect(layout.nodes).toHaveLength(values.length);
          expect(violations(layout, children)).toEqual([]);
        },
      ),
    );
  });
});
