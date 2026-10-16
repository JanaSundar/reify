"use client";

import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import type { EntryChange } from "./changes";
import { LAYOUT, ROW } from "@/components/motion";

export interface EntryRow {
  /** Stable identity: field name or map key identity. */
  readonly id: string;
  readonly label: ReactNode;
  /** Display width of the label in characters, for column alignment. */
  readonly labelLength: number;
  readonly value: ReactNode;
  readonly change?: EntryChange;
}

const MAX_KEY_CH = 22;

/**
 * Aligned key → value rows, shared by objects and maps. Rows keep their identity, enter and
 * leave with a short slide, and the rest close the gap. `separator` carries the semantic
 * difference: `:` for properties, `→` for map entries.
 */
export function EntryRows({
  rows,
  separator,
  keyClassName,
}: {
  rows: readonly EntryRow[];
  separator: string;
  keyClassName: string;
}) {
  const width = Math.min(MAX_KEY_CH, Math.max(2, ...rows.map((row) => row.labelLength)));
  return (
    <div
      role="list"
      className="relative flex flex-col gap-px text-sm"
      style={{ "--key-w": `${width + 3}ch` } as CSSProperties}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {rows.map((row) => (
          <motion.div
            role="listitem"
            key={row.id}
            layout="position"
            transition={LAYOUT}
            {...ROW}
            aria-label={row.change ? `${row.id} (${row.change})` : undefined}
            className={`grid grid-cols-[minmax(0,var(--key-w))_minmax(0,1fr)] items-start gap-x-2 rounded-md px-1.5 py-0.5 transition-colors duration-200 ${
              row.change ? "bg-changed" : ""
            }`}
          >
            <span className={`flex min-w-0 items-baseline gap-1 font-mono ${keyClassName}`}>
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="text-faint">{separator}</span>
            </span>
            <span className="min-w-0">{row.value}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
