"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { SWAP_SCALE } from "@/components/motion";
import { TONE } from "@/components/tones";

export type CellTone = "blue" | "violet";

interface ArrayCellsProps {
  readonly cells: readonly ReactNode[];
  /** Total slots to draw; slots past `cells.length` render as empty placeholders. */
  readonly slots?: number;
  readonly tone?: CellTone;
  readonly active?: number | null;
  readonly size?: "sm" | "md" | "lg";
  readonly indices?: boolean;
}

const SIZE = {
  sm: "h-8 min-w-8 text-[13px] rounded-md",
  md: "h-10 min-w-10 text-[15px] rounded-lg",
  lg: "h-[52px] min-w-[52px] text-[17px] rounded-xl",
} as const;

/** An array drawn as indexed cells. New cells pop in; the active cell gets an accent ring. */
export function ArrayCells({
  cells,
  slots = cells.length,
  tone = "blue",
  active = null,
  size = "md",
  indices = true,
}: ArrayCellsProps) {
  return (
    <ol className={`flex flex-wrap ${size === "lg" ? "gap-2.5" : "gap-1.5"}`}>
      {Array.from({ length: Math.max(slots, cells.length) }, (_, index) => {
        const filled = index < cells.length;
        return (
          <li key={index} className="flex flex-col items-center gap-1.5">
            {indices && (
              <span className="font-mono text-[11px] leading-none text-faint">{index}</span>
            )}
            <div
              className={`relative grid place-items-center px-2 font-mono font-medium text-ink tabular-nums ${SIZE[size]} ${
                filled ? TONE[tone] : "border border-dashed border-border-strong"
              } transition-shadow duration-200 ${active === index ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
            >
              <AnimatePresence initial={false}>
                {filled && (
                  <motion.span
                    key="value"
                    {...SWAP_SCALE}
                    transition={{ type: "spring", duration: 0.35, bounce: 0.2 }}
                  >
                    {cells[index]}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Small "Array" / "Array(3)" type tag shown next to a variable name. */
export function TypeTag({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-faint">{children}</span>;
}
