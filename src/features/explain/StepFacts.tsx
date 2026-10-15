import type { Fact, FactKind, StepView } from "@/engine/core/trace/stepView";

const ICON: Record<FactKind, string> = {
  line: "→",
  call: "↘",
  return: "↗",
  declare: "+",
  assign: "=",
  write: "✎",
  mutate: "✎",
  branch: "?",
  console: "›",
  throw: "!",
};

/** Renders `code` spans inside fact text without using HTML injection. */
function FactText({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.92em]">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

const MAX_FACTS = 12;

/** Deterministic facts about the current step, taken from the trace (no AI). */
export function StepFacts({ view }: { view: StepView }) {
  const facts: readonly Fact[] = view.facts;
  const shown = facts.slice(0, MAX_FACTS);
  return (
    <ul aria-label="What happened in this step" className="space-y-1 text-sm">
      {shown.map((fact, index) => (
        <li key={index} className="flex gap-2">
          <span
            aria-hidden
            className={`w-4 shrink-0 text-center font-mono ${fact.kind === "throw" ? "text-danger" : "text-faint"}`}
          >
            {ICON[fact.kind]}
          </span>
          <span className={fact.kind === "throw" ? "text-danger" : "text-text/90"}>
            <FactText text={fact.text} />
          </span>
        </li>
      ))}
      {facts.length > MAX_FACTS && (
        <li className="pl-6 text-xs text-faint">… {facts.length - MAX_FACTS} more events</li>
      )}
      {facts.length === 0 && <li className="text-faint">Program start</li>}
    </ul>
  );
}
