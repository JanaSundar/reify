"use client";

import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Command,
  Pause,
  Play,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Menu } from "@/components/Menu";
import type { TraceStore } from "@/engine/core/trace/TraceStore";
import { usePreference } from "@/hooks/usePreference";

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const BASE_INTERVAL_MS = 420;
/** Above this many steps the track is drawn as a line instead of individual dots. */
const MAX_DOTS = 48;
const EASE = [0.23, 1, 0.32, 1] as const;

interface TimelineProps {
  readonly store: TraceStore;
  readonly position: number;
  readonly total: number;
  /** Lines where playback pauses. */
  readonly breakpoints: readonly number[];
  readonly onShowShortcuts: () => void;
}

const isSpeed = (value: unknown): value is number =>
  typeof value === "number" && (SPEEDS as readonly number[]).includes(value);

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="press grid size-9 place-items-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** Playback over recorded history. Never re-runs the program. */
export function Timeline({ store, position, total, breakpoints, onShowShortcuts }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = usePreference<number>("speed", 1, isSpeed);
  const [hover, setHover] = useState<{ step: number; x: number } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const empty = total === 0;
  const last = Math.max(0, total - 1);
  const atEnd = position >= last;
  const isPlaying = playing && !atEnd && !empty;
  const progress = empty ? 0 : (position / Math.max(1, last)) * 100;

  useEffect(() => {
    if (!isPlaying) return;
    const stops = new Set(breakpoints);
    const timer = setInterval(() => {
      store.stepBy(1);
      const now = store.getSnapshot().position;
      const line = store.lineAt(now);
      if (line !== null && stops.has(line)) setPlaying(false);
    }, BASE_INTERVAL_MS / speed);
    return () => clearInterval(timer);
  }, [isPlaying, speed, store, breakpoints]);

  const stepAtPointer = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return { step: Math.round(ratio * last), x: ratio * rect.width };
  };

  const togglePlay = () => {
    if (atEnd) {
      store.seek(0);
      setPlaying(true);
    } else setPlaying(!isPlaying);
  };

  // Space plays and pauses, unless typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== " " || event.defaultPrevented) return;
      if (target?.closest("input, textarea, select, button, [contenteditable='true'], .cm-editor"))
        return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const hoverLine = hover ? store.lineAt(hover.step) : null;

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <motion.button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        disabled={empty}
        onClick={togglePlay}
        whileTap={{ scale: 0.94 }}
        className="grid size-14 shrink-0 place-items-center rounded-full bg-ink text-bg shadow-[0_10px_24px_-10px_var(--shadow-color)] transition-opacity disabled:opacity-40"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={isPlaying ? "pause" : "play"}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.15, ease: EASE }}
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="translate-x-px" />
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <div className="flex shrink-0 items-center gap-0.5 rounded-xl p-0.5 shadow-[inset_0_0_0_1px_var(--border)]">
        <IconButton
          label="First step (Alt+Home)"
          onClick={() => store.seek(0)}
          disabled={empty || position === 0}
        >
          <ChevronFirst size={16} />
        </IconButton>
        <IconButton
          label="Step back (Alt+←)"
          onClick={() => store.stepBy(-1)}
          disabled={empty || position === 0}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          label="Step forward (Alt+→)"
          onClick={() => store.stepBy(1)}
          disabled={empty || atEnd}
        >
          <ChevronRight size={16} />
        </IconButton>
        <IconButton
          label="Last step (Alt+End)"
          onClick={() => store.seek(last)}
          disabled={empty || atEnd}
        >
          <ChevronLast size={16} />
        </IconButton>
      </div>

      <span className="hidden shrink-0 text-[13px] font-medium text-ink tabular-nums sm:block">
        {empty ? "No trace" : `Step ${position + 1} of ${total}`}
      </span>

      <div
        ref={track}
        className="relative mx-2 h-8 min-w-24 flex-1"
        onPointerMove={(event) => !empty && setHover(stepAtPointer(event.clientX))}
        onPointerLeave={() => setHover(null)}
      >
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-surface-3" />
        <motion.div
          className="absolute top-1/2 left-0 h-[2px] -translate-y-1/2 rounded-full bg-accent"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.25, ease: EASE }}
        />
        {total > 1 && total <= MAX_DOTS
          ? Array.from({ length: total }, (_, index) => (
              <span
                key={index}
                aria-hidden
                style={{ left: `${(index / last) * 100}%` }}
                className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ${
                  index <= position ? "bg-accent" : "bg-surface-3"
                }`}
              />
            ))
          : null}
        {!empty && (
          <motion.span
            aria-hidden
            className="absolute top-1/2 size-4 rounded-full border-[3px] border-accent bg-surface shadow-[0_0_0_4px_var(--accent-soft)]"
            animate={{ left: `${progress}%` }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{ x: "-50%", y: "-50%" }}
          />
        )}
        <input
          type="range"
          aria-label="Execution step"
          min={0}
          max={last}
          value={position}
          disabled={empty}
          onChange={(event) => store.seek(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
        <AnimatePresence>
          {hover && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{ left: hover.x }}
              className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[11px] whitespace-nowrap text-bg tabular-nums"
            >
              Step {hover.step + 1}
              {hoverLine !== null && ` · line ${hoverLine}`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Menu
        label="Playback speed"
        side="top"
        align="end"
        trigger={
          <button
            type="button"
            aria-label={`Playback speed ${speed}x`}
            className="press flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--border)] tabular-nums"
          >
            {speed}x <ChevronDown size={14} className="text-faint" />
          </button>
        }
        items={SPEEDS.map((value) => ({
          label: `${value}x`,
          hint: value === speed ? "✓" : undefined,
          onSelect: () => setSpeed(value),
        }))}
      />
      <button
        type="button"
        aria-label="Keyboard shortcuts (?)"
        title="Keyboard shortcuts (?)"
        onClick={onShowShortcuts}
        className="press grid size-9 shrink-0 place-items-center rounded-lg text-ink shadow-[inset_0_0_0_1px_var(--border)]"
      >
        <Command size={15} />
      </button>
    </div>
  );
}
