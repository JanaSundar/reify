"use client";

import { motion } from "motion/react";
import { useId } from "react";

interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{
    readonly value: T;
    readonly label: string;
    readonly badge?: string;
  }>;
  readonly onChange: (value: T) => void;
  readonly size?: "sm" | "md";
}

/** Mutually exclusive options (tabs, modes) with a sliding selection indicator. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: SegmentedProps<T>) {
  const indicator = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`relative inline-flex items-center gap-1.5 rounded-md font-medium transition-colors ${
              size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm"
            } ${selected ? "text-text" : "text-muted hover:text-text"}`}
          >
            {selected && (
              <motion.span
                layoutId={indicator}
                aria-hidden
                className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.08)]"
              />
            )}
            <span className="relative">{option.label}</span>
            {option.badge && (
              <span className="relative rounded px-1 text-[11px] text-muted tabular-nums">
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
