"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** App-wide motion defaults: a soft spring, and no movement for users who ask for less. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
    >
      {children}
    </MotionConfig>
  );
}
