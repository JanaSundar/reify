"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useId } from "react";
import { PointerTags, StructureNode } from "./atoms";
import { layoutTree, type TreeShape } from "./structures";
import { LAYOUT } from "@/components/motion";

const COLUMN = 44;
const ROW = 58;
const NODE = 34;
/** Space above each node for pointer tags. */
const TOP = 18;

/**
 * A recognized tree drawn top-down. Positions come from a deterministic layout of the
 * recorded state; nodes are keyed by heap identity and glide to new positions when the
 * shape changes, edges follow them.
 */
export function TreeView({ shape }: { shape: TreeShape }) {
  const group = useId();
  const layout = layoutTree(shape);
  const at = new Map(layout.nodes.map((node) => [node.id, node]));
  const width = layout.width * COLUMN;
  const height = (layout.depth + 1) * ROW;
  const cx = (x: number) => x * COLUMN + COLUMN / 2;
  const cy = (y: number) => y * ROW + TOP + NODE / 2;

  return (
    <LayoutGroup id={group}>
      <div className="max-w-full overflow-x-auto pb-1">
        <div className="relative" style={{ width, height }}>
          <svg
            aria-hidden
            width={width}
            height={height}
            className="absolute inset-0 text-border-strong"
          >
            <AnimatePresence initial={false}>
              {layout.edges.map(({ from, to }) => {
                const a = at.get(from)!;
                const b = at.get(to)!;
                return (
                  <motion.line
                    key={`${from}-${to}`}
                    initial={{ opacity: 0, x1: cx(a.x), y1: cy(a.y), x2: cx(b.x), y2: cy(b.y) }}
                    animate={{ opacity: 1, x1: cx(a.x), y1: cy(a.y), x2: cx(b.x), y2: cy(b.y) }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    transition={LAYOUT}
                    stroke="currentColor"
                    strokeWidth={1.3}
                  />
                );
              })}
            </AnimatePresence>
          </svg>
          <AnimatePresence initial={false}>
            {layout.nodes.map((node) => {
              return (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, scale: 0.8, x: cx(node.x) - COLUMN / 2, y: node.y * ROW }}
                  animate={{ opacity: 1, scale: 1, x: cx(node.x) - COLUMN / 2, y: node.y * ROW }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.14 } }}
                  transition={LAYOUT}
                  className="absolute top-0 left-0 flex flex-col items-center justify-end"
                  style={{ width: COLUMN, height: TOP + NODE }}
                >
                  <span className="flex items-end pb-0.5 whitespace-nowrap" style={{ height: TOP }}>
                    <PointerTags id={node.id} />
                  </span>
                  <StructureNode
                    id={node.id}
                    className="rounded-full text-[13px]"
                    style={{ width: NODE, height: NODE }}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </LayoutGroup>
  );
}
