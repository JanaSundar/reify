import type { ConsoleLevel } from "@/engine/core/protocol/events";
import type { ConsoleLine } from "@/engine/core/trace/TraceStore";

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: "text-text",
  info: "text-[var(--val-number)]",
  debug: "text-muted",
  warn: "text-warning",
  error: "text-danger",
};

/** Program output up to the current step; later output is shown dimmed. */
export function ConsolePanel({
  lines,
  visibleCount,
}: {
  lines: readonly ConsoleLine[];
  visibleCount: number;
}) {
  if (lines.length === 0) return <p className="px-3 py-2 text-sm text-faint">No output.</p>;
  return (
    <ol aria-label="Console output" className="font-mono text-[13px]">
      {lines.map((line, index) => (
        <li
          key={index}
          className={`border-b border-border/60 px-3 py-1 whitespace-pre-wrap ${LEVEL_CLASS[line.level]} ${
            index >= visibleCount ? "opacity-35" : ""
          }`}
        >
          {line.text}
        </li>
      ))}
    </ol>
  );
}
