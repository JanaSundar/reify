"use client";

import { useState } from "react";
import type {
  EncodedValue,
  HeapId,
  HeapObject,
  PrimitiveValue,
} from "@/engine/core/protocol/values";
import type { HeapChange } from "@/engine/core/trace/stepView";
import { useInspector } from "./InspectorContext";

/** Objects nested deeper than this start collapsed. */
const AUTO_EXPAND_DEPTH = 2;
const MAX_CELLS = 200;

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
  const { selected, select } = useInspector();
  const active = selected === id;
  return (
    <button
      type="button"
      onClick={() => select(active ? null : id)}
      title={
        cyclic
          ? "Reference back to an enclosing object (cycle)"
          : "Highlight every reference to this object"
      }
      className={`press inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-xs ring-1 ${
        active ? "bg-accent text-accent-fg ring-accent" : "text-muted ring-border hover:text-text"
      }`}
    >
      {cyclic && <span aria-hidden>↻</span>}
      {label ?? "obj"}#{id}
    </button>
  );
}

interface ValueViewProps {
  readonly value: EncodedValue;
  readonly depth?: number;
  /** Heap ids of enclosing objects, for cycle detection. */
  readonly ancestors?: readonly HeapId[];
}

const NO_ANCESTORS: readonly HeapId[] = [];

export function ValueView({ value, depth = 0, ancestors = NO_ANCESTORS }: ValueViewProps) {
  const { view } = useInspector();
  if (value.kind === "primitive") return <PrimitiveText value={value} />;
  const object = view.heap.get(value.id);
  if (!object) return <span className="font-mono text-faint">#{value.id}</span>;
  if (ancestors.includes(value.id)) return <RefChip id={value.id} label={object.typeName} cyclic />;
  return <HeapObjectView object={object} depth={depth} ancestors={[...ancestors, value.id]} />;
}

const changedKeys = (change: HeapChange | undefined, key: number | string): boolean =>
  change === "all" || (change !== undefined && change.has(key));

function HeapObjectView({
  object,
  depth,
  ancestors,
}: {
  object: HeapObject;
  depth: number;
  ancestors: readonly HeapId[];
}) {
  const { view, selected } = useInspector();
  const [open, setOpen] = useState(depth < AUTO_EXPAND_DEPTH);
  const change = view.heapChanges.get(object.id);

  if (object.kind === "callable")
    return <span className="font-mono text-[var(--val-type)]">ƒ {object.name}</span>;
  if (object.kind === "opaque") {
    return (
      <span className="font-mono text-muted">
        {object.typeName} <span className="text-faint">{object.summary}</span>
      </span>
    );
  }

  const size =
    object.kind === "map"
      ? object.entries.length
      : object.kind === "list" || object.kind === "set"
        ? object.items.length
        : object.fields.length;
  const total = size + (object.omitted ?? 0);
  const following = selected === object.id;

  return (
    <div
      className={`inline-flex max-w-full min-w-0 flex-col gap-1 rounded-md ${
        following ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""
      } ${change === "all" ? "bg-changed" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="press rounded px-0.5 text-faint hover:text-text"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        <RefChip id={object.id} label={object.typeName} />
        <span className="text-faint">
          {total}{" "}
          {object.kind === "list"
            ? "items"
            : object.kind === "record" || object.kind === "instance"
              ? "fields"
              : "entries"}
        </span>
      </div>
      {open && <HeapBody object={object} depth={depth} ancestors={ancestors} change={change} />}
    </div>
  );
}

function HeapBody({
  object,
  depth,
  ancestors,
  change,
}: {
  object: Exclude<HeapObject, { kind: "callable" | "opaque" }>;
  depth: number;
  ancestors: readonly HeapId[];
  change: HeapChange | undefined;
}) {
  const omitted = object.omitted ? (
    <span className="text-xs text-faint">… {object.omitted} more not captured</span>
  ) : null;
  switch (object.kind) {
    case "list":
      return (
        <>
          <ListView items={object.items} depth={depth} ancestors={ancestors} change={change} />
          {omitted}
        </>
      );
    case "set":
      return (
        <div className="flex flex-wrap gap-1.5 pl-4">
          {object.items.map((item, i) => (
            <span key={i} className="rounded border border-border px-1.5 py-0.5">
              <ValueView value={item} depth={depth + 1} ancestors={ancestors} />
            </span>
          ))}
          {omitted}
        </div>
      );
    case "map":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 pl-4 text-sm">
          {object.entries.map(([key, value], i) => (
            <div key={i} className="contents">
              <dt className="font-mono">
                <ValueView value={key} depth={depth + 1} ancestors={ancestors} />
                <span className="text-faint"> →</span>
              </dt>
              <dd className="min-w-0">
                <ValueView value={value} depth={depth + 1} ancestors={ancestors} />
              </dd>
            </div>
          ))}
          {omitted}
        </dl>
      );
    case "record":
    case "instance":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 pl-4 text-sm">
          {object.fields.map(([key, value]) => (
            <div
              key={key}
              className={`contents ${changedKeys(change, key) ? "[&>*]:bg-changed" : ""}`}
            >
              <dt className="rounded-l px-0.5 font-mono text-muted">{key}:</dt>
              <dd className="min-w-0 rounded-r px-0.5">
                <ValueView value={value} depth={depth + 1} ancestors={ancestors} />
              </dd>
            </div>
          ))}
          {omitted}
        </dl>
      );
  }
}

/** Lists of lists of primitives render as a matrix (derived from shape, not names). */
function ListView({
  items,
  depth,
  ancestors,
  change,
}: {
  items: readonly EncodedValue[];
  depth: number;
  ancestors: readonly HeapId[];
  change: HeapChange | undefined;
}) {
  const { view } = useInspector();
  const [showAll, setShowAll] = useState(false);
  const rows = items.map((item) => (item.kind === "ref" ? view.heap.get(item.id) : undefined));
  const isMatrix =
    items.length > 0 &&
    rows.every(
      (row) =>
        row?.kind === "list" &&
        row.items.length <= 64 &&
        row.items.every((cell) => cell.kind === "primitive"),
    );

  if (isMatrix) {
    return (
      <table className="ml-4 border-separate border-spacing-0 font-mono text-xs">
        <tbody>
          {rows.map((row, r) => {
            const rowChange = view.heapChanges.get(row!.id);
            return (
              <tr key={r}>
                <th className="pr-2 text-right font-normal text-faint">{r}</th>
                {row!.kind === "list" &&
                  row!.items.map((cell, c) => (
                    <td
                      key={c}
                      className={`min-w-8 border border-border px-1.5 py-0.5 text-center ${changedKeys(rowChange, c) ? "bg-changed" : ""}`}
                    >
                      {cell.kind === "primitive" ? <PrimitiveText value={cell} /> : null}
                    </td>
                  ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const visible = showAll ? items : items.slice(0, MAX_CELLS);
  return (
    <div className="flex flex-wrap items-start gap-y-2 pl-4">
      {visible.map((item, index) => (
        <div key={index} className="flex min-w-9 flex-col items-center">
          <div
            className={`flex min-h-7 w-full items-center justify-center border border-border px-1.5 py-0.5 text-sm ${
              index === 0 ? "rounded-l" : "-ml-px"
            } ${index === visible.length - 1 ? "rounded-r" : ""} ${changedKeys(change, index) ? "bg-changed" : ""}`}
          >
            {item.kind === "primitive" ? (
              <PrimitiveText value={item} />
            ) : depth + 1 < AUTO_EXPAND_DEPTH && !ancestors.includes(item.id) ? (
              <ValueView value={item} depth={depth + 1} ancestors={ancestors} />
            ) : (
              <RefChip
                id={item.id}
                label={view.heap.get(item.id)?.typeName}
                cyclic={ancestors.includes(item.id)}
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-faint">{index}</span>
        </div>
      ))}
      {items.length > MAX_CELLS && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="press ml-2 self-center text-xs text-accent"
        >
          show {items.length - MAX_CELLS} more
        </button>
      )}
    </div>
  );
}
