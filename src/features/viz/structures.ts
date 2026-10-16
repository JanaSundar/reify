import type {
  EncodedValue,
  HeapId,
  HeapObject,
  PrimitiveValue,
  RecordObject,
} from "@/engine/core/protocol/values";

type Heap = ReadonlyMap<HeapId, HeapObject>;

/**
 * Abstract data structures recognized on top of ordinary objects. The runtime only knows
 * records and references, so recognition is a heuristic over shape: every result is
 * `inferred` and the UI must say so. Anything ambiguous returns null and is drawn as an
 * ordinary object.
 */
export interface LinkedListShape {
  readonly kind: "linked-list";
  readonly nodes: readonly HeapId[];
  readonly nextField: string;
  /** Node the last `next` points back to, when the list is cyclic. */
  readonly cycleTo: HeapId | null;
}

export interface TreeShape {
  readonly kind: "tree";
  readonly root: HeapId;
  /** Child slots per node, in field order; null marks an empty binary slot. */
  readonly children: ReadonlyMap<HeapId, ReadonlyArray<HeapId | null>>;
  readonly binary: boolean;
}

export type StructureShape = LinkedListShape | TreeShape;

const NEXT_FIELDS = ["next"];
const BINARY_FIELDS = ["left", "right"] as const;
const CHILDREN_FIELDS = ["children"];
/** Back references that do not make a node part of another structure. */
const BACK_FIELDS = new Set(["prev", "parent"]);
const VALUE_FIELDS = ["val", "value", "data", "key", "v"];
const SUGGESTIVE_NAME = /node|list|tree/i;
/** Larger structures are drawn as ordinary objects, which scale better. */
export const MAX_STRUCTURE_NODES = 127;

type NodeObject = RecordObject;

const asNode = (heap: Heap, value: EncodedValue | undefined): NodeObject | null => {
  if (value?.kind !== "ref") return null;
  const object = heap.get(value.id);
  return object?.kind === "record" || object?.kind === "instance" ? object : null;
};

const field = (object: NodeObject, name: string): EncodedValue | undefined =>
  object.fields.find(([key]) => key === name)?.[1];

const isEmpty = (value: EncodedValue | undefined): boolean =>
  value?.kind === "primitive" && (value.type === "null" || value.type === "undefined");

const signature = (object: NodeObject): string =>
  `${object.kind}:${object.typeName}:${object.fields.map(([key]) => key).join(",")}`;

/** Ref fields other than the structural and back-reference ones point at a same-shape node. */
const hasForeignLinks = (
  heap: Heap,
  node: NodeObject,
  structural: readonly string[],
  sig: string,
): boolean =>
  node.fields.some(([key, value]) => {
    if (structural.includes(key) || BACK_FIELDS.has(key)) return false;
    const other = asNode(heap, value);
    return other !== null && signature(other) === sig;
  });

const recognizeList = (heap: Heap, head: NodeObject): LinkedListShape | null => {
  const nextField = NEXT_FIELDS.find((name) => field(head, name) !== undefined);
  if (!nextField || head.omitted) return null;
  const sig = signature(head);
  const nodes: HeapId[] = [];
  const seen = new Set<HeapId>();
  let current: NodeObject | null = head;
  let cycleTo: HeapId | null = null;
  while (current) {
    if (signature(current) !== sig || hasForeignLinks(heap, current, [nextField], sig)) return null;
    nodes.push(current.id);
    seen.add(current.id);
    if (nodes.length > MAX_STRUCTURE_NODES) return null;
    const next = field(current, nextField);
    if (isEmpty(next)) break;
    const node = asNode(heap, next);
    if (!node) return null;
    if (seen.has(node.id)) {
      cycleTo = node.id;
      break;
    }
    current = node;
  }
  if (nodes.length < 2 && !SUGGESTIVE_NAME.test(head.typeName)) return null;
  return { kind: "linked-list", nodes, nextField, cycleTo };
};

const childSlots = (heap: Heap, node: NodeObject, binary: boolean): Array<HeapId | null> | null => {
  if (binary) {
    const slots: Array<HeapId | null> = [];
    for (const name of BINARY_FIELDS) {
      const value = field(node, name);
      if (isEmpty(value)) slots.push(null);
      else {
        const child = asNode(heap, value);
        if (!child) return null;
        slots.push(child.id);
      }
    }
    return slots;
  }
  const list = field(node, CHILDREN_FIELDS[0]!);
  const object = list?.kind === "ref" ? heap.get(list.id) : undefined;
  if (object?.kind !== "list" || object.omitted) return null;
  const slots: HeapId[] = [];
  for (const item of object.items) {
    const child = asNode(heap, item);
    if (!child) return null;
    slots.push(child.id);
  }
  return slots;
};

const recognizeTree = (heap: Heap, root: NodeObject): TreeShape | null => {
  const binary = BINARY_FIELDS.every((name) => field(root, name) !== undefined);
  const general = !binary && CHILDREN_FIELDS.some((name) => field(root, name) !== undefined);
  if (!binary && !general) return null;
  const structural = binary ? [...BINARY_FIELDS] : CHILDREN_FIELDS;
  const sig = signature(root);
  const children = new Map<HeapId, Array<HeapId | null>>();
  const queue: NodeObject[] = [root];
  const seen = new Set<HeapId>([root.id]);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if (signature(node) !== sig || node.omitted) return null;
    if (hasForeignLinks(heap, node, structural, sig)) return null;
    const slots = childSlots(heap, node, binary);
    if (!slots) return null;
    children.set(node.id, slots);
    for (const id of slots) {
      if (id === null) continue;
      // A node reached twice is a shared reference or a cycle: not a tree.
      if (seen.has(id)) return null;
      seen.add(id);
      queue.push(heap.get(id) as NodeObject);
    }
    if (seen.size > MAX_STRUCTURE_NODES) return null;
  }
  if (seen.size < 2 && !SUGGESTIVE_NAME.test(root.typeName)) return null;
  return { kind: "tree", root: root.id, children, binary };
};

/** Recognizes the structure rooted at `id`, or null when it is not clearly one. */
export const recognizeStructure = (heap: Heap, id: HeapId): StructureShape | null => {
  const node = asNode(heap, { kind: "ref", id });
  if (!node) return null;
  return recognizeTree(heap, node) ?? recognizeList(heap, node);
};

const STRUCTURAL = new Set<string>([...NEXT_FIELDS, ...BINARY_FIELDS, ...CHILDREN_FIELDS]);

/** The value a node displays: a conventional value field, else its first primitive field. */
export const nodeValue = (heap: Heap, id: HeapId): PrimitiveValue | null => {
  const node = asNode(heap, { kind: "ref", id });
  if (!node) return null;
  const named = VALUE_FIELDS.map((name) => field(node, name)).find(
    (value) => value?.kind === "primitive",
  );
  if (named?.kind === "primitive") return named;
  const first = node.fields.find(
    ([key, value]) => !STRUCTURAL.has(key) && !BACK_FIELDS.has(key) && value.kind === "primitive",
  );
  return first?.[1].kind === "primitive" ? first[1] : null;
};

export interface TreeNodeLayout {
  readonly id: HeapId;
  /** Column (in node widths) and depth. */
  readonly x: number;
  readonly y: number;
}

export interface TreeEdgeLayout {
  readonly from: HeapId;
  readonly to: HeapId;
}

export interface TreeLayout {
  readonly nodes: readonly TreeNodeLayout[];
  readonly edges: readonly TreeEdgeLayout[];
  readonly width: number;
  readonly depth: number;
}

/**
 * Tidy-enough layout: leaves take consecutive columns in order, parents sit centered over
 * their children. Binary trees reserve half a column for a missing child so left and right
 * stay distinguishable.
 */
export const layoutTree = (shape: TreeShape): TreeLayout => {
  const nodes: TreeNodeLayout[] = [];
  const edges: TreeEdgeLayout[] = [];
  let column = 0;
  let depth = 0;
  const place = (id: HeapId, y: number): number => {
    depth = Math.max(depth, y);
    const slots = shape.children.get(id) ?? [];
    const [left, right] = slots;
    if (shape.binary && (left === null) !== (right === null)) {
      // One child: offset the parent toward the missing side.
      if (left === null) column += 0.5;
      const child = (left ?? right)!;
      edges.push({ from: id, to: child });
      const childX = place(child, y + 1);
      if (right === null) column += 0.5;
      const x = left === null ? childX - 0.5 : childX + 0.5;
      nodes.push({ id, x, y });
      return x;
    }
    const xs: number[] = [];
    for (const child of slots) {
      if (child === null) continue;
      edges.push({ from: id, to: child });
      xs.push(place(child, y + 1));
    }
    const x = xs.length > 0 ? (xs[0]! + xs.at(-1)!) / 2 : column++;
    nodes.push({ id, x, y });
    return x;
  };
  place(shape.root, 0);
  const width = Math.max(1, ...nodes.map((node) => node.x + 1));
  return { nodes, edges, width, depth };
};
