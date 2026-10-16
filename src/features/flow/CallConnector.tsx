"use client";

import { motion } from "motion/react";
import { useLayoutEffect, useState, type RefObject } from "react";
import { LAYOUT } from "@/components/motion";

export interface Connector {
  /** Line from the call to the cell (always one cubic segment, so it animates smoothly). */
  readonly path: string;
  /** Filled arrowhead pointing up into the cell. */
  readonly head: string;
  /** Where the line leaves the call. */
  readonly start: { readonly x: number; readonly y: number };
}

export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** How long to keep following layout animations after the target or step changes. */
const FOLLOW_MS = 600;
/** Gap between the arrow tip and the cell. */
const GAP = 3;
/** The line leaves the pill's top only away from its rounded corners. */
const CORNER = 12;
const HEAD_W = 4;
const HEAD_H = 7;

const point = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;

/**
 * Routes a connector from the call `pill` to the cell whose bottom centre is `target`.
 *
 * - Target above the pill: a straight vertical line from the pill's top at the cell's x.
 * - Otherwise: one smooth arc that leaves the pill's nearer side horizontally and turns
 *   up into the cell, arriving vertically so the arrowhead points straight at it.
 */
export const connectorPath = (pill: Box, target: { x: number; y: number }): Connector => {
  const tip = { x: target.x, y: target.y + GAP };
  const base = tip.y + HEAD_H;
  let start: { x: number; y: number };
  let c1: { x: number; y: number };
  let c2: { x: number; y: number };
  if (target.x >= pill.left + CORNER && target.x <= pill.right - CORNER) {
    start = { x: target.x, y: pill.top };
    const third = (start.y - base) / 3;
    c1 = { x: start.x, y: start.y - third };
    c2 = { x: start.x, y: base + third };
  } else {
    const left = target.x < pill.left;
    start = { x: left ? pill.left : pill.right, y: (pill.top + pill.bottom) / 2 };
    // Quadratic arc through the corner (target.x, start.y), written as a cubic.
    const corner = { x: target.x, y: start.y };
    c1 = { x: start.x + (2 / 3) * (corner.x - start.x), y: start.y };
    c2 = { x: target.x, y: base + (2 / 3) * (corner.y - base) };
  }
  return {
    path: `M ${point(start.x, start.y)} C ${point(c1.x, c1.y)}, ${point(c2.x, c2.y)}, ${point(tip.x, base)}`,
    head: `M ${point(tip.x - HEAD_W, base)} L ${point(tip.x, tip.y)} L ${point(tip.x + HEAD_W, base)} Z`,
    start,
  };
};

/**
 * Measures a connector from `pill` to the element marked `data-cell={cell}` inside
 * `container`, in container coordinates. Presentation only: it reads the DOM after the
 * recorded state rendered and follows cells while their layout animation runs.
 */
export function useCellConnector(
  container: RefObject<HTMLElement | null>,
  pill: RefObject<HTMLElement | null>,
  cell: string | null,
  revision: unknown,
): Connector | null {
  const [connector, setConnector] = useState<Connector | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const box = container.current?.getBoundingClientRect();
      const from = pill.current?.getBoundingClientRect();
      const to = cell
        ? container.current?.querySelector(`[data-cell="${cell}"]`)?.getBoundingClientRect()
        : undefined;
      const next =
        box && from && to && to.bottom + GAP + HEAD_H < from.top
          ? connectorPath(
              {
                left: from.left - box.left,
                right: from.right - box.left,
                top: from.top - box.top,
                bottom: from.bottom - box.top,
              },
              { x: to.left + to.width / 2 - box.left, y: to.bottom - box.top },
            )
          : null;
      setConnector((current) => (current?.path === next?.path ? current : next));
    };
    let frame = 0;
    const until = performance.now() + FOLLOW_MS;
    const follow = () => {
      measure();
      if (performance.now() < until) frame = requestAnimationFrame(follow);
    };
    follow();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // `revision` (the step) is a deliberate trigger: cells may move between steps.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [container, pill, cell, revision]);

  return connector;
}

/** Draws a measured connector over the flow; the line, head and anchor glide together. */
export function CallConnector({ connector }: { connector: Connector }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible text-accent"
    >
      <motion.path
        initial={false}
        animate={{ d: connector.path }}
        transition={LAYOUT}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <motion.path
        initial={false}
        animate={{ d: connector.head }}
        transition={LAYOUT}
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <motion.circle
        initial={false}
        animate={{ cx: connector.start.x, cy: connector.start.y }}
        transition={LAYOUT}
        r={2.5}
        fill="currentColor"
      />
    </svg>
  );
}
