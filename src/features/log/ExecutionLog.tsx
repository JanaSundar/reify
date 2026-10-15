"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDot,
  CornerDownRight,
  GitBranch,
  PenLine,
  Plus,
  SquareTerminal,
  TriangleAlert,
  Play,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { TraceStore } from "@/engine/core/trace/TraceStore";
import type { StepEventKind, StepSummary } from "@/engine/core/trace/summary";

/** Rows rendered on each side of the current step (keeps very long traces light). */
const WINDOW = 150;
/** Replay time per step at 1× speed, used for the time column. */
const STEP_MS = 420;

const ICON: Record<StepEventKind, LucideIcon> = {
  start: Play,
  line: CornerDownRight,
  call: ArrowDownRight,
  return: ArrowUpRight,
  declare: Plus,
  assign: PenLine,
  write: PenLine,
  mutate: CircleDot,
  branch: GitBranch,
  console: SquareTerminal,
  throw: TriangleAlert,
};

const clock = (step: number): string => {
  const seconds = Math.floor((step * STEP_MS) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

interface ExecutionLogProps {
  readonly store: TraceStore;
  readonly position: number;
  readonly total: number;
  readonly runId: number | null;
}

/** Every recorded step as one event line; the current step is highlighted, click to jump. */
export function ExecutionLog({ store, position, total, runId }: ExecutionLogProps) {
  const current = useRef<HTMLLIElement>(null);
  const from = Math.max(0, Math.floor(position / WINDOW) * WINDOW - WINDOW);
  const to = Math.min(total, from + WINDOW * 3);
  // Summaries depend on the recorded events only; recompute when the window or trace changes.
  const rows: StepSummary[] = useMemo(
    () => store.summaries(from, to),
    // runId and total identify the recorded trace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, from, to, runId, total],
  );

  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [position]);

  if (total === 0)
    return (
      <p className="px-5 py-3 text-[13px] text-faint">Run your code to record its execution.</p>
    );

  return (
    <ol aria-label="Execution log" className="py-1 text-[13px]">
      {from > 0 && <li className="px-5 py-1 text-[12px] text-faint">… {from} earlier steps</li>}
      {rows.map((row) => {
        const Icon = ICON[row.kind];
        const active = row.step === position;
        return (
          <li key={row.step} ref={active ? current : undefined}>
            <button
              type="button"
              onClick={() => store.seek(row.step)}
              aria-current={active ? "step" : undefined}
              className={`grid w-full grid-cols-[40px_56px_20px_minmax(140px,180px)_1fr] items-center gap-3 px-5 py-1.5 text-left transition-colors ${
                active ? "bg-accent-soft" : "hover:bg-surface-2"
              }`}
            >
              <span className="text-faint tabular-nums">{row.step + 1}</span>
              <span
                className={`font-mono text-[12px] tabular-nums ${active ? "text-accent" : "text-muted"}`}
              >
                {clock(row.step)}
              </span>
              <Icon size={14} className={row.kind === "throw" ? "text-danger" : "text-ink"} />
              <span className={`truncate ${active ? "font-medium text-ink" : "text-text"}`}>
                {row.label}
              </span>
              <code className="truncate font-mono text-[12px] text-muted">{row.detail}</code>
            </button>
          </li>
        );
      })}
      {to < total && (
        <li className="px-5 py-1 text-[12px] text-faint">… {total - to} more steps</li>
      )}
    </ol>
  );
}

/** Plain-text log of the whole trace, for copying. */
export const logAsText = (store: TraceStore, total: number): string =>
  store
    .summaries(0, total)
    .map((row) => `${row.step + 1}\t${clock(row.step)}\t${row.label}\t${row.detail}`)
    .join("\n");
