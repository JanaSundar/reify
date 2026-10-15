"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { RunFailure } from "@/engine/core/coordinator/ExecutionCoordinator";
import type { RunOutcome } from "@/engine/core/protocol/limits";
import type { ProgramInfo } from "@/engine/core/protocol/program";

type Tone = "danger" | "warning" | "muted";

export interface BannerMessage {
  readonly tone: Tone;
  readonly title: string;
  readonly details: readonly string[];
}

/** Pure mapping from run results to a user-facing message. */
export const bannerFor = (
  failure: RunFailure | null,
  outcome: RunOutcome | null,
  program: ProgramInfo | null,
  sourceChanged: boolean,
): BannerMessage | null => {
  if (failure?.kind === "compile") {
    return {
      tone: "danger",
      title: "This code can't run yet",
      details: failure.diagnostics.map((d) =>
        d.range ? `Line ${d.range.line}: ${d.message}` : d.message,
      ),
    };
  }
  if (failure?.kind === "internal")
    return { tone: "danger", title: "Execution failed", details: [failure.message] };
  if (outcome?.kind === "exception") {
    const line = outcome.loc !== null ? program?.locs[outcome.loc]?.line : undefined;
    return {
      tone: "danger",
      title: `Uncaught ${outcome.message}`,
      details: line ? [`Thrown while running line ${line}.`] : [],
    };
  }
  if (outcome?.kind === "limit") {
    return {
      tone: "warning",
      title: "Execution stopped",
      details: [outcome.message, "The trace up to that point is shown."],
    };
  }
  if (outcome?.kind === "cancelled") {
    return {
      tone: "muted",
      title: "Run cancelled",
      details: ["The trace recorded before cancelling is shown."],
    };
  }
  if (sourceChanged) {
    return {
      tone: "muted",
      title: "Code changed since this run",
      details: ["Run again (Ctrl+Enter) to trace the new version."],
    };
  }
  return null;
};

const TONE_CLASS: Record<Tone, string> = {
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/12 text-warning",
  muted: "bg-surface-2 text-muted",
};

export function RunBanner({ message }: { message: BannerMessage | null }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key={message.title}
          role={message.tone === "danger" ? "alert" : "status"}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className={`mx-3 mt-3 rounded-xl px-3.5 py-2.5 text-sm ${TONE_CLASS[message.tone]}`}
        >
          <p className="font-medium">{message.title}</p>
          {message.details.map((detail) => (
            <p key={detail} className="mt-0.5 text-xs opacity-90">
              {detail}
            </p>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
