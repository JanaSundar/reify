"use client";

import { ChevronRight } from "lucide-react";
import { isolated } from "@/lib/events";

/**
 * Expand/collapse chevron. Clicks stay inside it, so a disclosure nested in a clickable row
 * does not trigger the row.
 */
export function DisclosureButton({
  open,
  onToggle,
  label,
  className = "",
}: {
  open: boolean;
  onToggle: () => void;
  /** What is expanded, for screen readers (e.g. a variable name). */
  label?: string;
  className?: string;
}) {
  const action = open ? "Collapse" : "Expand";
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label ? `${action} ${label}` : action}
      onClick={isolated(onToggle)}
      className={`grid size-4 shrink-0 place-items-center rounded ${className}`}
    >
      <ChevronRight
        size={13}
        className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      />
    </button>
  );
}
