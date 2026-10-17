"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { RunFailure } from "@/engine/core/coordinator/ExecutionCoordinator";
import type { RunOutcome } from "@/engine/core/protocol/limits";
import type { ProgramInfo } from "@/engine/core/protocol/program";
import { easeOut } from "@/components/motion";

type Tone = "danger" | "warning" | "muted";

/** A place in a project file, which the banner lets the user jump to. */
export interface BannerLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export type Navigate = (location: BannerLocation) => void;

export type BannerDetail = string | (BannerLocation & { readonly text: string });

export interface BannerMessage {
  readonly tone: Tone;
  readonly title: string;
  readonly details: readonly BannerDetail[];
}

/** Describes a place as `path:line`, linking it when the diagnostic names a file. */
const located = (
  path: string | undefined,
  line: number,
  column: number,
  text: string,
): BannerDetail =>
  path ? { path, line, column, text: `${path}:${line} — ${text}` } : `Line ${line}: ${text}`;

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
        d.range
          ? located(d.path, d.range.line, d.range.column, d.message)
          : d.path
            ? { path: d.path, line: 1, column: 0, text: `${d.path} — ${d.message}` }
            : d.message,
      ),
    };
  }
  if (failure?.kind === "internal")
    return { tone: "danger", title: "Execution failed", details: [failure.message] };
  if (outcome?.kind === "exception") {
    const loc = outcome.loc !== null ? program?.locs[outcome.loc] : undefined;
    const path =
      loc && program && program.files.length > 1 ? program.files[loc.file]?.path : undefined;
    return {
      tone: "danger",
      title: `Uncaught ${outcome.message}`,
      details: !loc
        ? []
        : path
          ? [{ path, line: loc.line, column: loc.column, text: `Thrown in ${path}:${loc.line}` }]
          : [`Thrown while running line ${loc.line}.`],
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

export function RunBanner({
  message,
  onNavigate,
}: {
  message: BannerMessage | null;
  onNavigate?: Navigate;
}) {
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
          transition={easeOut(0.18)}
          className={`mx-3 mt-3 rounded-xl px-3.5 py-2.5 text-sm ${TONE_CLASS[message.tone]}`}
        >
          <p className="font-medium">{message.title}</p>
          {message.details.map((detail) =>
            typeof detail === "string" ? (
              <p key={detail} className="mt-0.5 text-xs opacity-90">
                {detail}
              </p>
            ) : (
              <p key={detail.text} className="mt-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => onNavigate?.(detail)}
                  className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {detail.text}
                </button>
              </p>
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
