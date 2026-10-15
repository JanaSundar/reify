import type { StepView } from "@/engine/core/trace/stepView";

/** Compact call stack, innermost call first. */
export function CallStack({ view }: { view: StepView }) {
  const frames = view.frames.toReversed();
  return (
    <ol aria-label="Call stack" className="flex flex-wrap items-center gap-1 font-mono text-xs">
      {frames.map((frame, index) => (
        <li key={frame.id} className="flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="text-faint">
              ←
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 ${index === 0 ? "bg-accent/15 text-accent" : "text-muted"}`}
            title={frame.callLoc ? `called at line ${frame.callLoc.line}` : undefined}
          >
            {frame.name === "global" ? "global" : `${frame.name}()`}
          </span>
        </li>
      ))}
    </ol>
  );
}
