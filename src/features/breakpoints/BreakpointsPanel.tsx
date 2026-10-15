"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface BreakpointsPanelProps {
  readonly lines: readonly number[];
  readonly source: string;
  readonly onRemove: (line: number) => void;
  readonly onClear: () => void;
}

/** Breakpoint lines of the open file; playback pauses when it reaches one. */
export function BreakpointsPanel({ lines, source, onRemove, onClear }: BreakpointsPanelProps) {
  const code = source.split("\n");
  if (lines.length === 0) {
    return (
      <p className="px-5 py-3 text-[13px] leading-relaxed text-faint">
        No breakpoints. Click left of a line number in the editor to add one — playback pauses when
        it reaches that line.
      </p>
    );
  }
  return (
    <div className="py-1">
      <ul className="text-[13px]">
        <AnimatePresence initial={false}>
          {lines.map((line) => (
            <motion.li
              key={line}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="group flex items-center gap-3 overflow-hidden px-5 py-1.5 hover:bg-surface-2"
            >
              <span className="size-2 shrink-0 rounded-full bg-accent" />
              <span className="w-16 shrink-0 text-muted tabular-nums">Line {line}</span>
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">
                {code[line - 1]?.trim() || <span className="text-faint">(empty line)</span>}
              </code>
              <button
                type="button"
                aria-label={`Remove breakpoint on line ${line}`}
                onClick={() => onRemove(line)}
                className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
              >
                <X size={14} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button
        type="button"
        onClick={onClear}
        className="px-5 py-2 text-[12px] text-accent hover:underline"
      >
        Remove all
      </button>
    </div>
  );
}
