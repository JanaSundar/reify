"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { formatCost, isConstant, type Cost } from "@/engine/core/analysis/cost";
import type { CostStep, StaticComplexity } from "@/engine/core/analysis/staticEstimate";
import { GrowthChart } from "./GrowthChart";
import { growthModel } from "./growthModel";

/** Rows deeper than this start collapsed. */
const OPEN_DEPTH = 3;

const KIND_LABEL: Record<CostStep["kind"], string> = {
  loop: "loop",
  scan: "built-in",
  call: "call",
};

/** What the children of a step add up to, per repetition. */
const EACH_LABEL: Record<CostStep["kind"], string> = {
  loop: "Each iteration",
  scan: "Each element",
  call: "Each call",
};

type Show = (cost: Cost) => string;

function Formula({ step, show }: { step: CostStep; show: Show }) {
  const multiplied = !isConstant(step.repeats) && !isConstant(step.each);
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
      {multiplied && (
        <>
          {show(step.repeats)} × {show(step.each)} ={" "}
        </>
      )}
      <span className={step.dominant ? "font-semibold text-ink" : "text-text"}>
        {show(step.total)}
      </span>
    </span>
  );
}

function StepRow({ step, show, depth }: { step: CostStep; show: Show; depth: number }) {
  const [open, setOpen] = useState(depth < OPEN_DEPTH);
  const expandable = step.children.length > 0;

  return (
    <li className={step.dominant ? undefined : "opacity-60"}>
      <div className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-2">
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${step.label}`}
            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded text-faint hover:text-text"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3 transition-transform duration-200 ease-[var(--ease-out)]"
              style={{ transform: open ? "rotate(90deg)" : "none" }}
              aria-hidden
            >
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        ) : (
          <span className="mt-[7px] size-4 shrink-0" aria-hidden>
            <span
              className={`mx-auto block size-1.5 rounded-full ${step.dominant ? "bg-accent" : "bg-faint"}`}
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-xs tabular-nums text-faint">L{step.line}</span>
              <code className="truncate font-mono text-[13px] text-ink" title={step.label}>
                {step.label}
              </code>
              <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-[10px] uppercase tracking-wide text-muted">
                {KIND_LABEL[step.kind]}
              </span>
            </div>
            <Formula step={step} show={show} />
          </div>
          <p className="mt-0.5 text-xs text-muted">{step.reason.replaceAll("`", "")}</p>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expandable && open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[13px] border-l border-border pl-2">
              <p className="px-1.5 pt-1 text-[11px] text-faint">
                {EACH_LABEL[step.kind]}: {show(step.each)}
              </p>
              <StepList steps={step.children} show={show} depth={depth + 1} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function StepList({
  steps,
  show,
  depth,
}: {
  steps: readonly CostStep[];
  show: Show;
  depth: number;
}) {
  return (
    <ul>
      {steps.map((step, i) => (
        <StepRow key={`${step.line}:${step.label}:${i}`} step={step} show={show} depth={depth} />
      ))}
    </ul>
  );
}

/**
 * Where the estimate comes from: every loop, built-in and call that costs more than O(1),
 * nested the way the code nests them. A row's cost is its repetitions × the cost of one
 * repetition (its children, added up); siblings add up, and only the fastest-growing
 * survive (the others are dimmed).
 */
export function CostBreakdown({ analysis }: { analysis: StaticComplexity }) {
  const order = analysis.sizes.map((size) => size.name);
  const show: Show = (cost) => formatCost(cost, order);
  const totals = analysis.steps.map((step) => show(step.total));

  return (
    <div className="mt-3">
      {analysis.sizes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Input sizes">
          {analysis.sizes.map((size) => (
            <li
              key={size.name}
              className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-text"
            >
              <span className="font-semibold text-ink">{size.name}</span>
              {size.of === size.name ? null : (
                <span className="text-muted">
                  {" "}
                  = {size.of === null ? "input size" : `size of ${size.of}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {totals.length > 1 && (
        <p className="mt-3 font-mono text-xs text-muted">
          {totals.join(" + ")} ={" "}
          <span className="font-semibold text-ink">{show(analysis.time)}</span>
        </p>
      )}
      <GrowthChart model={growthModel(analysis, show)} />
      <div className="mt-4 -mx-1.5">
        <StepList steps={analysis.steps} show={show} depth={0} />
      </div>
    </div>
  );
}
