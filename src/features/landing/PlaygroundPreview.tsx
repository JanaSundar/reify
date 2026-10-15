"use client";

import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExecutionFlow } from "@/features/flow/ExecutionFlow";
import { Inspector } from "@/features/inspector/Inspector";
import { MiniCode } from "./MiniCode";
import type { CompiledPreview } from "./previewProgram";
import { recordPreview } from "./recordPreview";

const STEP_MS = 1100;
/** Pause on the last step before looping, so the result can be read. */
const END_PAUSE_MS = 2400;
const EASE = [0.23, 1, 0.32, 1] as const;

const pane = "glass-pane rounded-2xl";
const iconButton =
  "press grid size-9 place-items-center rounded-xl text-ink transition-colors hover:bg-surface-2 disabled:opacity-35";

/**
 * A live miniature of the playground: the example is traced by the real engine in the
 * browser, and the flow and inspector are the playground's own components. It plays itself
 * while on screen; every control works.
 */
export function PlaygroundPreview({ preview }: { preview: CompiledPreview }) {
  const [store] = useState(() => recordPreview(preview));
  const trace = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const root = useRef<HTMLDivElement>(null);
  const visible = useInView(root, { amount: 0.35 });
  const reduce = useReducedMotion();
  const [userPaused, setUserPaused] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const playing = visible && !userPaused && !reduce;
  const { position, totalSteps: total, view } = trace;
  const last = Math.max(0, total - 1);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => store.seek(position >= last ? 0 : position + 1),
      position >= last ? END_PAUSE_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, position, last, store]);

  const seek = (step: number) => {
    setUserPaused(true);
    store.seek(step);
  };
  const event = store.summaries(position, position + 1)[0];
  const output = trace.console.findLast((line) => line.step <= position);

  return (
    <div ref={root} className="glass rounded-[26px] p-2">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-3 pt-1 pb-2.5">
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-2.5 rounded-full bg-border-strong" />
          ))}
        </div>
        <span className="mx-auto rounded-lg glass-pane px-3 py-1 font-mono text-[12px] text-muted">
          {preview.fileName}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <span className="relative flex size-1.5">
            {playing && (
              <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
            )}
            <span className="relative size-1.5 rounded-full bg-success" />
          </span>
          Live trace
        </span>
      </div>

      {/* Panes: the playground's editor, flow and inspector */}
      <div className="grid h-[420px] gap-2 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(0,0.8fr)]">
        <div className={`hidden overflow-hidden py-4 md:block ${pane}`}>
          <MiniCode
            code={preview.source.trimEnd()}
            active={view?.loc?.line ?? null}
            className="px-2 text-[12.5px] leading-[28px]"
          />
        </div>
        <div className={`relative flex min-h-0 flex-col overflow-hidden ${pane}`}>
          <div className="flex items-baseline justify-between px-5 pt-4">
            <h3 className="text-[15px] font-semibold tracking-tight text-ink">Execution Flow</h3>
            <span className="text-[12px] text-muted tabular-nums">
              Step {position + 1} of {total}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {view && (
              <ExecutionFlow view={view} languageBadge="JS" focus={focus} onFocus={setFocus} />
            )}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-2xl bg-gradient-to-t from-[light-dark(rgb(255_255_255/0.8),rgb(18_18_23/0.8))] to-transparent"
          />
        </div>
        <div className={`hidden min-h-0 overflow-hidden lg:block ${pane}`}>
          <Inspector view={view} focus={focus} onFocus={setFocus} />
        </div>
      </div>

      {/* Playback */}
      <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 ${pane}`}>
        <motion.button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setUserPaused(playing)}
          whileTap={{ scale: 0.94 }}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-bg"
        >
          {playing ? (
            <Pause size={14} fill="currentColor" />
          ) : (
            <Play size={14} fill="currentColor" className="translate-x-px" />
          )}
        </motion.button>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Previous step"
            className={iconButton}
            disabled={position === 0}
            onClick={() => seek(position - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="Next step"
            className={iconButton}
            disabled={position >= last}
            onClick={() => seek(position + 1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            aria-label="Restart"
            className={iconButton}
            onClick={() => {
              store.seek(0);
              setUserPaused(false);
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>

        <div className="relative flex h-6 min-w-40 flex-1 items-center justify-between">
          <span className="absolute inset-x-2 h-[2px] rounded-full bg-surface-3" />
          <motion.span
            className="absolute left-2 h-[2px] rounded-full bg-accent"
            animate={{ width: `calc((100% - 16px) * ${position / Math.max(1, last)})` }}
            transition={{ duration: 0.3, ease: EASE }}
          />
          {Array.from({ length: total }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Go to step ${index + 1}`}
              onClick={() => seek(index)}
              className="relative grid size-4 place-items-center"
            >
              <span
                className={`size-2 rounded-full transition-[background-color,transform] duration-200 ${
                  index <= position ? "bg-accent" : "bg-surface-3"
                } ${index === position ? "scale-[1.6] shadow-[0_0_0_3px_var(--accent-soft)]" : ""}`}
              />
            </button>
          ))}
        </div>

        <div className="w-full min-w-0 text-[12.5px] sm:w-72">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={position}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: EASE }}
              className="truncate"
            >
              <span className="font-medium text-ink">{event?.label}</span>{" "}
              <code className="font-mono text-[12px] text-muted">{event?.detail}</code>
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <p className="h-7 truncate px-4 pt-2 font-mono text-[12px] text-muted">
        <span className="text-faint">console ›</span> {output?.text ?? ""}
      </p>
    </div>
  );
}
