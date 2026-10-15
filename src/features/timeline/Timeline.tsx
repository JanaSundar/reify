"use client";

import { useEffect, useState } from "react";
import type { TraceStore } from "@/engine/core/trace/TraceStore";

const SPEEDS = [
  { label: "0.5×", intervalMs: 800 },
  { label: "1×", intervalMs: 400 },
  { label: "2×", intervalMs: 200 },
  { label: "4×", intervalMs: 80 },
] as const;

interface TimelineProps {
  readonly store: TraceStore;
  readonly position: number;
  readonly total: number;
}

function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="press grid size-8 place-items-center rounded-md text-lg leading-none text-muted hover:bg-surface-2 hover:text-text disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

/** Playback over recorded history. Never re-runs the program. */
export function Timeline({ store, position, total }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const atEnd = position >= total - 1;
  const empty = total === 0;
  const isPlaying = playing && !atEnd && !empty;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => store.stepBy(1), SPEEDS[speed]!.intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, speed, store]);

  return (
    <div className="flex items-center gap-1 border-t border-border bg-surface px-2 py-1.5">
      <ControlButton
        label="First step (Alt+Home)"
        onClick={() => store.seek(0)}
        disabled={empty || position === 0}
      >
        «
      </ControlButton>
      <ControlButton
        label="Step back (Alt+←)"
        onClick={() => store.stepBy(-1)}
        disabled={empty || position === 0}
      >
        ‹
      </ControlButton>
      <ControlButton
        label={isPlaying ? "Pause" : "Play"}
        onClick={() => (atEnd ? (store.seek(0), setPlaying(true)) : setPlaying(!isPlaying))}
        disabled={empty}
      >
        {isPlaying ? "❚❚" : "▶"}
      </ControlButton>
      <ControlButton
        label="Step forward (Alt+→)"
        onClick={() => store.stepBy(1)}
        disabled={empty || atEnd}
      >
        ›
      </ControlButton>
      <ControlButton
        label="Last step (Alt+End)"
        onClick={() => store.seek(total - 1)}
        disabled={empty || atEnd}
      >
        »
      </ControlButton>
      <input
        type="range"
        aria-label="Execution step"
        min={0}
        max={Math.max(0, total - 1)}
        value={position}
        disabled={empty}
        onChange={(event) => store.seek(Number(event.target.value))}
        className="mx-2 h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-default"
      />
      <span className="min-w-24 text-right font-mono text-xs text-muted tabular-nums">
        {empty ? "no trace" : `${position + 1} / ${total}`}
      </span>
      <select
        aria-label="Playback speed"
        value={speed}
        onChange={(event) => setSpeed(Number(event.target.value))}
        className="ml-1 rounded-md border border-border bg-surface px-1 py-1 text-xs text-muted"
      >
        {SPEEDS.map((s, i) => (
          <option key={s.label} value={i}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
