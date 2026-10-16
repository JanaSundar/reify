"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { easeOut } from "@/components/motion";

interface RevealProps extends HTMLMotionProps<"div"> {
  /** Seconds to wait after entering the viewport (for staggering siblings). */
  readonly delay?: number;
  /** Starting offset; defaults to a short lift. */
  readonly from?: { readonly x?: number; readonly y?: number; readonly scale?: number };
  readonly duration?: number;
}

const LIFT = { y: 30 } as const;

/** Fades content into place once, when it scrolls into view. */
export function Reveal({
  delay = 0,
  from = LIFT,
  duration = 0.7,
  children,
  ...props
}: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: from.x ?? 0, y: from.y ?? 0, scale: from.scale ?? 1 }}
      whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={easeOut(duration, delay)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
