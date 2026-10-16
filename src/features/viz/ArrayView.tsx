"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { HeapObject, ListObject } from "@/engine/core/protocol/values";
import { useInspector } from "@/features/inspector/InspectorContext";
import { LAYOUT, POP } from "@/components/motion";
import {
  CollectionFrame,
  EntryValue,
  PrimitiveText,
  toneOf,
  useCellKeys,
  useChanges,
  type RenderValue,
} from "./atoms";
import { changesIn } from "./changes";

/** Cells drawn before offering to show the rest. */
export const MAX_CELLS = 200;
const MAX_MATRIX_COLUMNS = 64;

const CELL = {
  sm: "min-h-7 min-w-9 rounded-[5px] px-1.5 text-sm",
  lg: "min-h-11 min-w-11 rounded-lg px-2.5 text-[15px] font-medium",
} as const;

interface ArrayViewProps {
  readonly object: ListObject;
  readonly renderValue: RenderValue;
  readonly size?: keyof typeof CELL;
}

/** Lists of short lists of primitives read better as a grid (derived from shape, not names). */
const matrixRows = (
  object: ListObject,
  heap: ReadonlyMap<number, HeapObject>,
): ListObject[] | null => {
  if (object.items.length === 0) return null;
  const rows: ListObject[] = [];
  for (const item of object.items) {
    const row = item.kind === "ref" ? heap.get(item.id) : undefined;
    if (
      row?.kind !== "list" ||
      row.items.length > MAX_MATRIX_COLUMNS ||
      !row.items.every((cell) => cell.kind === "primitive")
    )
      return null;
    rows.push(row);
  }
  return rows;
};

/**
 * An array as ordered, indexed cells. Cells keep their identity across steps, so sorting
 * moves them, inserting or removing shifts the rest, and writes change a value in place.
 */
export function ArrayView({ object, renderValue, size = "sm" }: ArrayViewProps) {
  const { view } = useInspector();
  const rows = matrixRows(object, view.heap);
  if (rows) return <MatrixView object={object} rows={rows} />;
  return <CellList object={object} renderValue={renderValue} size={size} />;
}

function CellList({ object, renderValue, size = "sm" }: ArrayViewProps) {
  const [showAll, setShowAll] = useState(false);
  const changes = useChanges(object);
  const keys = useCellKeys(object.items);
  const visible = showAll ? object.items.length : Math.min(object.items.length, MAX_CELLS);

  return (
    <CollectionFrame object={object} changes={changes} empty={object.items.length === 0}>
      <ol className="relative flex flex-wrap items-start gap-x-1 gap-y-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {object.items.slice(0, visible).map((item, index) => {
            const change = changes.entries.get(String(index));
            return (
              <motion.li
                key={keys[index]}
                layout="position"
                transition={LAYOUT}
                {...POP}
                data-cell={`${object.id}:${index}`}
                className="flex flex-col items-center gap-1"
              >
                <div
                  aria-label={change ? `index ${index}, ${change}` : `index ${index}`}
                  className={`grid place-items-center font-mono tabular-nums transition-[background-color,box-shadow] duration-200 ${CELL[size]} ${toneOf(change)}`}
                >
                  <EntryValue value={item} renderValue={renderValue} />
                </div>
                <span className="font-mono text-[10px] leading-none text-faint">{index}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {object.items.length > visible && (
          <li className="self-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="ml-1 text-xs text-accent"
            >
              show {object.items.length - visible} more
            </button>
          </li>
        )}
      </ol>
    </CollectionFrame>
  );
}

function MatrixView({ object, rows }: { object: ListObject; rows: ListObject[] }) {
  const { view } = useInspector();
  return (
    <CollectionFrame object={object} changes={changesIn(view, object)} empty={false}>
      <table className="border-separate border-spacing-0.5 font-mono text-xs">
        <tbody>
          {rows.map((row, r) => {
            const changes = changesIn(view, row);
            return (
              <tr key={r}>
                <th className="pr-2 text-right font-normal text-faint">{r}</th>
                {row.items.map((cell, c) => (
                  <td
                    key={c}
                    className={`min-w-8 rounded-[3px] px-1.5 py-0.5 text-center transition-colors duration-200 ${toneOf(changes.entries.get(String(c)))}`}
                  >
                    {cell.kind === "primitive" && <PrimitiveText value={cell} />}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </CollectionFrame>
  );
}
