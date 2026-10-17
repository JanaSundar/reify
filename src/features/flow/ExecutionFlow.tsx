"use client";

import { Link2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import type { StepView } from "@/engine/core/trace/stepView";
import { TypeTag } from "@/components/viz/ArrayCells";
import { InspectorProvider } from "@/features/inspector/InspectorContext";
import { ValueView } from "@/features/inspector/ValueView";
import { activeCall, callTarget, flowVariables, stepNote, type FlowVariable } from "./flowModel";
import { CallConnector, useCellConnector } from "./CallConnector";
import { easeOut, SWAP_Y } from "@/components/motion";
import { TONE } from "@/components/tones";

interface ExecutionFlowProps {
  readonly view: StepView;
  readonly languageBadge: string;
  /** Variable name highlighted from the inspector. */
  readonly focus: string | null;
  readonly onFocus: (name: string | null) => void;
}

function VariableHeading({ item }: { item: FlowVariable }) {
  return (
    <>
      <span className="font-mono text-[15px] font-semibold text-ink">{item.name}</span>
      <TypeTag>{item.type}</TypeTag>
    </>
  );
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
  const { changed } = item;
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={easeOut(0.3, index * 0.04)}
      onClick={() => onFocus(focused ? null : item.name)}
      className={`group cursor-pointer rounded-xl p-2 transition-[background-color,box-shadow] duration-200 ${
        focused ? "bg-accent-soft edge-blue" : "hover:bg-surface-2"
      }`}
    >
      {item.shape === "array" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <VariableHeading item={item} />
          </div>
          <ValueView value={item.variable.value} size="lg" bare />
        </div>
      ) : item.shape === "primitive" ? (
        <div className="flex items-center gap-2.5">
          <VariableHeading item={item} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={item.preview}
              {...SWAP_Y}
              transition={easeOut(0.2)}
              className={`rounded-lg px-3 py-1.5 font-mono text-[14px] font-medium text-ink ${
                TONE[changed ? "violet" : "blue"]
              }`}
            >
              {item.preview}
            </motion.span>
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <VariableHeading item={item} />
            {item.sharedWith.length > 0 && (
              <span className="flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                <Link2 size={11} /> same reference as {item.sharedWith.join(", ")}
              </span>
            )}
          </div>
          <div
            className={`w-fit max-w-full overflow-x-auto rounded-lg p-2.5 ${
              TONE[changed ? "violet" : "neutral"]
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
  const target = callTarget(view);
  const container = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const connector = useCellConnector(
    container,
    pill,
    call && target ? `${target.id}:${target.index}` : null,
    view,
  );

  return (
    <InspectorProvider view={view}>
      <div ref={container} className="relative flex flex-col gap-3 px-5 py-4">
        {connector && <CallConnector connector={connector} />}
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
                transition={easeOut(0.2)}
                // No decorative arrows: the only pointer is the connector, drawn when the call
                // works on a specific cell.
                className="flex flex-col items-center"
              >
                <span
                  ref={pill}
                  title={target ? `Working on ${target.reason}` : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[13px] whitespace-nowrap text-violet ${TONE.violet}`}
                >
                  {call}
                  <span className="rounded bg-surface px-1 text-[10px] font-semibold text-accent">
                    {languageBadge}
                  </span>
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={note}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={easeOut(0.18)}
              className="max-w-[34ch] min-w-[180px] flex-1 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed text-muted edge"
            >
              {note}
            </motion.p>
          </AnimatePresence>
        </div>

        {inner && (
          <div className="rounded-2xl p-1 edge">
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
