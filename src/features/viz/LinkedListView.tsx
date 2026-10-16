"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useId } from "react";
import { LAYOUT, POP } from "@/components/motion";
import { PointerTags, StructureNode } from "./atoms";
import type { LinkedListShape } from "./structures";

function Arrow({ label }: { label?: string }) {
  return (
    <span aria-hidden className="flex h-9 items-center self-end px-0.5 text-faint">
      <svg width="22" height="10" viewBox="0 0 22 10" className="overflow-visible">
        <path d="M0 5h18M14 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      {label && <span className="ml-1 font-mono text-[11px]">{label}</span>}
    </span>
  );
}

/**
 * A recognized singly linked list: value boxes joined by `next` arrows, ending in the empty
 * value as the language writes it (`null`, `None`) or
 * looping back (drawn as a labelled return arrow, never by repeating nodes). Nodes are keyed
 * by heap identity, so relinking moves them instead of redrawing them.
 */
export function LinkedListView({ shape }: { shape: LinkedListShape }) {
  const group = useId();
  const position = new Map(shape.nodes.map((id, i) => [id, i]));
  return (
    <LayoutGroup id={group}>
      <ol className="relative flex flex-wrap items-end gap-y-3 pt-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {shape.nodes.map((id, i) => {
            return (
              <motion.li
                key={id}
                layout="position"
                transition={LAYOUT}
                {...POP}
                className="flex items-end"
              >
                <span className="flex flex-col items-center gap-1">
                  <PointerTags id={id} />
                  <StructureNode id={id} className="min-h-9 min-w-10 rounded-lg px-2.5 text-sm" />
                </span>
                {i < shape.nodes.length - 1 && <Arrow />}
              </motion.li>
            );
          })}
        </AnimatePresence>
        <li className="flex h-9 items-center">
          {shape.cycleTo === null ? (
            <>
              <Arrow />
              <span className="font-mono text-xs text-[var(--val-keyword)]">{shape.end}</span>
            </>
          ) : (
            <span
              title="The last node points back to an earlier node: the list is cyclic"
              className="flex items-center"
            >
              <Arrow label={`↻ node ${(position.get(shape.cycleTo) ?? 0) + 1}`} />
            </span>
          )}
        </li>
      </ol>
    </LayoutGroup>
  );
}
