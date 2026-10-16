"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { DisclosureButton } from "@/components/DisclosureButton";
import {
  entryCount,
  type EncodedValue,
  type HeapId,
  type HeapObject,
} from "@/engine/core/protocol/values";
import { isolated } from "@/lib/events";
import { ArrayView } from "@/features/viz/ArrayView";
import { EXPAND } from "@/components/motion";
import { followRing, PrimitiveText, RefChip, type RenderValue } from "@/features/viz/atoms";
import { LinkedListView } from "@/features/viz/LinkedListView";
import { MapView } from "@/features/viz/MapView";
import { ObjectView } from "@/features/viz/ObjectView";
import { SetView } from "@/features/viz/SetView";
import { recognizeStructure, type StructureShape } from "@/features/viz/structures";
import { TreeView } from "@/features/viz/TreeView";
import { useInspector } from "./InspectorContext";

/** Objects nested deeper than this start collapsed. */
const AUTO_EXPAND_DEPTH = 2;

type Size = "sm" | "lg";

interface ValueViewProps {
  readonly value: EncodedValue;
  readonly depth?: number;
  /** Heap ids of enclosing objects, for cycle detection. */
  readonly ancestors?: readonly HeapId[];
  /** Cell size for arrays drawn at this level. */
  readonly size?: Size;
  /** Draw the contents only, without the collapsible header (the caller labels it). */
  readonly bare?: boolean;
}

const NO_ANCESTORS: readonly HeapId[] = [];

/**
 * Draws any runtime value with the primitive that fits its runtime kind: arrays as cells,
 * objects as property rows, maps as key → value rows, sets as chips, and recognized linked
 * lists and trees as node diagrams. Language-neutral: it only reads the encoded heap.
 */
export function ValueView({
  value,
  depth = 0,
  ancestors = NO_ANCESTORS,
  size = "sm",
  bare = false,
}: ValueViewProps) {
  const { view } = useInspector();
  if (value.kind === "primitive") return <PrimitiveText value={value} />;
  const object = view.heap.get(value.id);
  if (!object) return <span className="font-mono text-faint">#{value.id}</span>;
  if (ancestors.includes(value.id)) return <RefChip id={value.id} label={object.typeName} cyclic />;
  return (
    <HeapObjectView
      object={object}
      depth={depth}
      ancestors={[...ancestors, value.id]}
      size={size}
      bare={bare}
    />
  );
}

type Container = Exclude<HeapObject, { kind: "callable" | "opaque" }>;

const UNIT: Record<Container["kind"], readonly [string, string]> = {
  list: ["item", "items"],
  set: ["entry", "entries"],
  map: ["entry", "entries"],
  record: ["field", "fields"],
  instance: ["field", "fields"],
};

/** Runtime size with its unit, e.g. `3 items`, `1 entry`. */
const sizeOf = (object: Container): string => {
  const count = entryCount(object);
  const [one, many] = UNIT[object.kind];
  return `${count} ${count === 1 ? one : many}`;
};

const STRUCTURE_LABEL: Record<StructureShape["kind"], string> = {
  "linked-list": "linked list",
  tree: "tree",
};

function HeapObjectView({
  object,
  depth,
  ancestors,
  size,
  bare,
}: {
  object: HeapObject;
  depth: number;
  ancestors: readonly HeapId[];
  size: Size;
  bare: boolean;
}) {
  const { view, selected, inbound } = useInspector();
  // Shared objects nested inside others start collapsed: they are drawn in full where they
  // are referenced directly, and the chip marks every other occurrence.
  const shared = depth > 0 && (inbound.get(object.id) ?? 0) > 1;
  const [open, setOpen] = useState(depth < AUTO_EXPAND_DEPTH && !shared);
  const [asObject, setAsObject] = useState(false);

  if (object.kind === "callable")
    return <span className="font-mono text-[var(--val-type)]">ƒ {object.name}</span>;
  if (object.kind === "opaque") {
    return (
      <span className="font-mono text-muted">
        {object.typeName} <span className="text-faint">{object.summary}</span>
      </span>
    );
  }

  const structure =
    object.kind === "record" || object.kind === "instance"
      ? recognizeStructure(view.heap, object.id)
      : null;
  const renderValue: RenderValue = (child) => (
    <ValueView value={child} depth={depth + 1} ancestors={ancestors} />
  );
  const body = (
    <Body
      object={object}
      structure={asObject ? null : structure}
      renderValue={renderValue}
      size={size}
    />
  );
  // A recognized structure always keeps its header, which says it was inferred.
  if (bare && !structure) return body;

  return (
    <div
      className={`inline-flex max-w-full min-w-0 flex-col gap-1 rounded-md ${followRing(selected === object.id)}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <DisclosureButton
          open={open}
          onToggle={() => setOpen(!open)}
          label={object.typeName}
          className="text-faint hover:text-text"
        />
        <RefChip id={object.id} label={object.typeName} />
        <span className="text-faint">{sizeOf(object)}</span>
        {structure && open && (
          <span className="flex items-center gap-1.5">
            <span
              title="Recognized from the object's shape, not declared by the program"
              className="rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted"
            >
              {STRUCTURE_LABEL[structure.kind]} · inferred
            </span>
            <button
              type="button"
              onClick={isolated(() => setAsObject(!asObject))}
              className="text-[11px] text-accent hover:underline"
            >
              {asObject ? `show as ${STRUCTURE_LABEL[structure.kind]}` : "show as object"}
            </button>
          </span>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" {...EXPAND} className="overflow-hidden">
            <div className="p-0.5 pl-5">{body}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Body({
  object,
  structure,
  renderValue,
  size,
}: {
  object: Container;
  structure: StructureShape | null;
  renderValue: RenderValue;
  size: Size;
}) {
  if (structure?.kind === "linked-list") return <LinkedListView shape={structure} />;
  if (structure?.kind === "tree") return <TreeView shape={structure} />;
  switch (object.kind) {
    case "list":
      return <ArrayView object={object} renderValue={renderValue} size={size} />;
    case "set":
      return <SetView object={object} renderValue={renderValue} />;
    case "map":
      return <MapView object={object} renderValue={renderValue} />;
    case "record":
    case "instance":
      return <ObjectView object={object} renderValue={renderValue} />;
  }
}
