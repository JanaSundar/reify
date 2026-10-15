"use client";

import { ArrowDown, Link2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { StepView } from "@/engine/core/trace/stepView";
import { ArrayCells, TypeTag } from "@/components/viz/ArrayCells";
import { InspectorProvider } from "@/features/inspector/InspectorContext";
import { ValueView } from "@/features/inspector/ValueView";
import { activeCall, flowVariables, stepNote, type FlowVariable } from "./flowModel";

const EASE = [0.23, 1, 0.32, 1] as const;

interface ExecutionFlowProps {
  readonly view: StepView;
  readonly languageBadge: string;
  /** Variable name highlighted from the inspector. */
  readonly focus: string | null;
  readonly onFocus: (name: string | null) => void;
}

function VariableBlock({
  item,
  index,
  focused,
  onFocus,
}: {
  item: FlowVariable;
  index: number;
  focused: boolean;
  onFocus: (name: string | null) => void;
}) {
  const changed = item.variable.changed || item.changedCells.length > 0;
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.3, ease: EASE, delay: index * 0.04 }}
      onClick={() => onFocus(focused ? null : item.name)}
      className={`group cursor-pointer rounded-xl p-2 transition-[background-color,box-shadow] duration-200 ${
        focused ? "bg-accent-soft shadow-[inset_0_0_0_1px_var(--blue-line)]" : "hover:bg-surface-2"
      }`}
    >
      {item.shape === "array" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[15px] font-semibold text-ink">{item.name}</span>
            <TypeTag>{item.type}</TypeTag>
          </div>
          <ArrayCells
            size="lg"
            tone={changed ? "violet" : "blue"}
            active={item.changedCells[0] ?? null}
            cells={item.cells.map((cell, i) => (
              <span key={i} title={`${item.name}[${i}] = ${cell}`}>
                {cell}
              </span>
            ))}
          />
        </div>
      ) : item.shape === "primitive" ? (
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[14px] font-semibold text-ink">{item.name}</span>
          <TypeTag>{item.type}</TypeTag>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={item.preview}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE }}
              className={`rounded-lg px-3 py-1.5 font-mono text-[14px] font-medium text-ink ${
                changed
                  ? "bg-violet-soft shadow-[inset_0_0_0_1px_var(--violet-line)]"
                  : "bg-[var(--blue-cell)] shadow-[inset_0_0_0_1px_var(--blue-line)]"
              }`}
            >
              {item.preview}
            </motion.span>
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[15px] font-semibold text-ink">{item.name}</span>
            <TypeTag>{item.type}</TypeTag>
            {item.sharedWith.length > 0 && (
              <span className="flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                <Link2 size={11} /> same reference as {item.sharedWith.join(", ")}
              </span>
            )}
          </div>
          <div
            className={`w-fit max-w-full overflow-x-auto rounded-lg p-2.5 ${
              changed
                ? "bg-violet-soft shadow-[inset_0_0_0_1px_var(--violet-line)]"
                : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--border)]"
            }`}
          >
            <ValueView value={item.variable.value} />
          </div>
        </div>
      )}
    </motion.div>
  );
}

/**
 * The current step drawn as data: top-level variables, then the running call (with a short
 * explanation of what just happened), then the call's own variables.
 */
export function ExecutionFlow({ view, languageBadge, focus, onFocus }: ExecutionFlowProps) {
  const global = view.frames[0];
  const inner = view.frames.length > 1 ? view.frames.at(-1)! : null;
  const outer = global ? flowVariables(view, global) : [];
  const local = inner ? flowVariables(view, inner) : [];
  const call = activeCall(view);
  const note = stepNote(view);

  return (
    <InspectorProvider view={view}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <AnimatePresence initial={false}>
          {outer.map((item, index) => (
            <VariableBlock
              key={item.key}
              item={item}
              index={index}
              focused={focus === item.name}
              onFocus={onFocus}
            />
          ))}
        </AnimatePresence>
        {outer.length === 0 && !call && (
          <p className="px-2 text-[13px] text-faint">No variables yet.</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-10">
          <AnimatePresence mode="wait" initial={false}>
            {call ? (
              <motion.div
                key={`call-${inner?.id}`}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="flex flex-col items-center gap-1"
              >
                <ArrowDown size={16} className="text-accent" />
                <span className="flex items-center gap-2 rounded-lg bg-violet-soft px-3 py-1.5 font-mono text-[13px] whitespace-nowrap text-violet shadow-[inset_0_0_0_1px_var(--violet-line)]">
                  {call}
                  <span className="rounded bg-surface px-1 text-[10px] font-semibold text-accent">
                    {languageBadge}
                  </span>
                </span>
                <ArrowDown size={16} className="text-accent" />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={note}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="max-w-[34ch] min-w-[180px] flex-1 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed text-muted shadow-[inset_0_0_0_1px_var(--border)]"
            >
              {note}
            </motion.p>
          </AnimatePresence>
        </div>

        {inner && (
          <div className="rounded-2xl p-1 shadow-[inset_0_0_0_1px_var(--border)]">
            <p className="px-3 pt-2 font-mono text-[11px] text-faint">inside {inner.name}()</p>
            <AnimatePresence initial={false}>
              {local.map((item, index) => (
                <VariableBlock
                  key={item.key}
                  item={item}
                  index={index}
                  focused={focus === item.name}
                  onFocus={onFocus}
                />
              ))}
            </AnimatePresence>
            {local.length === 0 && (
              <p className="px-3 pb-2 text-[12px] text-faint">No local variables.</p>
            )}
          </div>
        )}
      </div>
    </InspectorProvider>
  );
}
