"use client";

import { motion } from "motion/react";
import { useId } from "react";

interface UnderlineTabsProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{
    readonly value: T;
    readonly label: string;
    readonly badge?: string;
  }>;
  readonly onChange: (value: T) => void;
  readonly className?: string;
}

/** Text tabs with an accent underline that slides to the selected tab. */
export function UnderlineTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: UnderlineTabsProps<T>) {
  const indicator = useId();
  return (
    <div role="tablist" aria-label={label} className={`flex items-stretch gap-6 ${className}`}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`relative flex items-center gap-1.5 py-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
              selected ? "text-accent" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
            {option.badge && (
              <span className="rounded bg-surface-2 px-1 text-[10.5px] text-muted tabular-nums">
                {option.badge}
              </span>
            )}
            {selected && (
              <motion.span
                layoutId={indicator}
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-accent"
                transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
