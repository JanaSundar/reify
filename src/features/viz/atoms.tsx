"use client";

import { Link2 } from "lucide-react";
import { motion } from "motion/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { easeOut, LAYOUT } from "@/components/motion";
import { TONE } from "@/components/tones";
import type {
  EncodedValue,
  HeapId,
  HeapObject,
  PrimitiveValue,
} from "@/engine/core/protocol/values";
import { useInspector } from "@/features/inspector/InspectorContext";
import { isolated } from "@/lib/events";
import { changesIn, type EntryChange, type EntryChanges } from "./changes";
import { initialKeys, reconcileKeys, valueIdentity, type CellKeys } from "./keys";
import { nodeValue } from "./structures";

/** Renders a nested value; supplied by the dispatcher so primitives never import it. */
export type RenderValue = (value: EncodedValue) => ReactNode;

/** Surface of a cell, row or node by what the current step did to it. */
export const toneOf = (change: EntryChange | undefined): string =>
  TONE[change ? "changed" : "neutral"];

/** Ring shown on objects the user is following. */
export const followRing = (following: boolean): string =>
  following ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "";

// ------------------------------------------------------------------ values

const PRIMITIVE_COLOR: Record<PrimitiveValue["type"], string> = {
  number: "text-[var(--val-number)]",
  bigint: "text-[var(--val-number)]",
  string: "text-[var(--val-string)]",
  boolean: "text-[var(--val-keyword)]",
  null: "text-[var(--val-keyword)]",
  undefined: "text-faint",
  symbol: "text-[var(--val-type)]",
  other: "text-faint italic",
};

export function PrimitiveText({ value }: { value: PrimitiveValue }) {
  return <span className={`font-mono ${PRIMITIVE_COLOR[value.type]}`}>{value.text}</span>;
}

/**
 * A primitive that re-enters when its value changes. Keyed by value, so it only animates
 * on an actual change, never on every step.
 */
export function ChangingText({ value }: { value: PrimitiveValue }) {
  return (
    <motion.span
      key={valueIdentity(value)}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOut(0.18)}
      className="inline-block"
    >
      <PrimitiveText value={value} />
    </motion.span>
  );
}

/** A value inside a collection: primitives inline (animating changes), objects nested. */
export function EntryValue({
  value,
  renderValue,
}: {
  value: EncodedValue;
  renderValue: RenderValue;
}) {
  return value.kind === "primitive" ? <ChangingText value={value} /> : renderValue(value);
}

// ------------------------------------------------------------------ identity

/** Identity chip: clicking follows the object (highlights every reference to it). */
export function RefChip({
  id,
  label,
  cyclic = false,
}: {
  id: HeapId;
  label?: string;
  cyclic?: boolean;
}) {
  const { selected, toggle, inbound } = useInspector();
  const active = selected === id;
  const shared = (inbound.get(id) ?? 0) > 1;
  return (
    <button
      type="button"
      onClick={isolated(() => toggle(id))}
      title={
        cyclic
          ? "Reference back to an enclosing object (cycle)"
          : shared
            ? "Shared: more than one reference points here. Click to highlight them all"
            : "Highlight every reference to this object"
      }
      className={`inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-xs ring-1 transition-colors ${
        active ? "bg-accent text-accent-fg ring-accent" : "text-muted ring-border hover:text-text"
      }`}
    >
      {cyclic && <span aria-hidden>↻</span>}
      {!cyclic && shared && <Link2 size={10} aria-label="shared" />}
      {label ?? "obj"}#{id}
    </button>
  );
}

/** Variable names currently pointing at an object (e.g. `head`, `cur`), from real refs. */
export function PointerTags({ id }: { id: HeapId }) {
  const { pointers } = useInspector();
  const names = pointers.get(id);
  if (!names) return null;
  return (
    <span className="flex flex-wrap justify-center gap-0.5">
      {names.map((name) => (
        <motion.span
          key={name}
          layoutId={`pointer-${name}`}
          transition={LAYOUT}
          className="rounded bg-accent-soft px-1 font-mono text-[10px] leading-4 text-accent"
        >
          {name}
        </motion.span>
      ))}
    </span>
  );
}

/**
 * A node of a recognized structure: its value (or identity when it has none), the
 * variables pointing at it, and the follow toggle. Shared by linked lists and trees.
 */
export function StructureNode({
  id,
  className,
  style,
}: {
  id: HeapId;
  className: string;
  style?: CSSProperties;
}) {
  const { view, selected, toggle } = useInspector();
  const value = nodeValue(view.heap, id);
  return (
    <button
      type="button"
      title={`${view.heap.get(id)?.typeName ?? "node"}#${id}`}
      onClick={() => toggle(id)}
      style={style}
      className={`grid place-items-center font-mono tabular-nums transition-[background-color,box-shadow] duration-200 ${toneOf(view.heapChanges.has(id) ? "updated" : undefined)} ${followRing(selected === id)} ${className}`}
    >
      {value ? <ChangingText value={value} /> : <span className="text-faint">#{id}</span>}
    </button>
  );
}

// ------------------------------------------------------------------ collections

/** Why an operation that mutated nothing made no change, by collection kind and operation. */
const NO_CHANGE_REASON: Partial<Record<HeapObject["kind"], Record<string, string>>> = {
  set: { add: "the value is already in the set", delete: "the value was not in the set" },
  map: { delete: "no such key", set: "the key already held that value" },
};

const EMPTY_LABEL: Partial<Record<HeapObject["kind"], string>> = {
  list: "[ ] empty",
  record: "{ } no properties",
  instance: "{ } no properties",
};

/**
 * The frame every collection primitive shares: its entries (or an empty marker), the count
 * of entries the engine did not capture, and a note when a mutation changed nothing.
 */
export function CollectionFrame({
  object,
  changes,
  empty,
  children,
}: {
  object: HeapObject;
  changes: EntryChanges;
  empty: boolean;
  children: ReactNode;
}) {
  const reason = changes.op ? NO_CHANGE_REASON[object.kind]?.[changes.op] : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {empty && !object.omitted ? (
        <span className="font-mono text-xs text-faint">
          {EMPTY_LABEL[object.kind] ?? "{ } empty"}
        </span>
      ) : (
        children
      )}
      {object.omitted ? (
        <span className="text-xs text-faint">… {object.omitted} more not captured</span>
      ) : null}
      {changes.unchanged && changes.op && (
        <motion.p
          key={changes.op}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={easeOut(0.2)}
          className="text-[11px] text-muted"
        >
          <span className="font-mono">{changes.op}()</span> made no change
          {reason ? ` — ${reason}` : ""}
        </motion.p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ hooks

/** What the current step did to this object's entries. */
export function useChanges(object: HeapObject): EntryChanges {
  return changesIn(useInspector().view, object);
}

/**
 * Stable, presentation-only keys for list cells, reconciled against the previously rendered
 * values (see {@link reconcileKeys}). Never feeds back into runtime state.
 */
export function useCellKeys(items: readonly EncodedValue[]): readonly string[] {
  const [state, setState] = useState<{ items: readonly EncodedValue[]; keys: CellKeys }>(() => ({
    items,
    keys: initialKeys(items),
  }));
  if (state.items !== items) {
    const next = { items, keys: reconcileKeys(state.keys, items) };
    setState(next);
    return next.keys.keys;
  }
  return state.keys.keys;
}
