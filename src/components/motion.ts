import type { Transition } from "motion/react";

/**
 * The app's motion vocabulary. Everything eases out on one curve; presets describe how
 * things enter and leave so the same kind of change always moves the same way.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** An ease-out tween of `duration` seconds (optionally delayed). */
export const easeOut = (duration: number, delay?: number): Transition =>
  delay ? { duration, delay, ease: EASE_OUT } : { duration, ease: EASE_OUT };

/** Positional changes (layout animations, moving nodes): short, no overshoot. */
export const LAYOUT = easeOut(0.24);

/** A value replaced in place: the old one leaves upward, the new one rises in. */
export const SWAP_Y = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -5 },
} as const;

/** A panel switched for another (tabs): it rises in and simply fades out. */
export const FADE_UP = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
} as const;

/** An icon or label replaced in place by scaling. */
export const SWAP_SCALE = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
} as const;

/** Items entering and leaving a collection. */
export const POP = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1, transition: easeOut(0.2) },
  exit: { opacity: 0, scale: 0.85, transition: easeOut(0.14) },
} as const;

/** Rows entering and leaving a list. */
export const ROW = {
  initial: { opacity: 0, x: -6 },
  animate: { opacity: 1, x: 0, transition: easeOut(0.2) },
  exit: { opacity: 0, x: 6, transition: easeOut(0.14) },
} as const;

/** Content that expands and collapses. */
export const EXPAND = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto", transition: easeOut(0.2) },
  exit: { opacity: 0, height: 0, transition: easeOut(0.15) },
} as const;
