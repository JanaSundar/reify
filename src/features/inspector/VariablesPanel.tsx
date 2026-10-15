"use client";

import type { BindingKind } from "@/engine/core/protocol/program";
import type { FrameView, StepView, VariableView } from "@/engine/core/trace/stepView";
import { InspectorProvider, useInspector } from "./InspectorContext";
import { ValueView } from "./ValueView";

const KIND_LABEL: Partial<Record<BindingKind, string>> = {
  param: "param",
  const: "const",
  let: "let",
  var: "var",
  catch: "catch",
  global: "global",
  class: "class",
};

const isCallable = (variable: VariableView, view: StepView): boolean =>
  variable.value.kind === "ref" && view.heap.get(variable.value.id)?.kind === "callable";

function VariableRow({ variable }: { variable: VariableView }) {
  return (
    <div
      className={`grid grid-cols-[minmax(4rem,auto)_1fr] items-start gap-x-3 rounded-md px-2 py-1.5 ${variable.changed ? "bg-changed" : ""}`}
    >
      <div className="flex items-baseline gap-1.5 pt-0.5">
        <span className="font-mono text-sm font-medium">{variable.name}</span>
        {KIND_LABEL[variable.kind] && (
          <span className="text-[10px] tracking-wide text-faint uppercase">
            {KIND_LABEL[variable.kind]}
          </span>
        )}
      </div>
      <div className="min-w-0 overflow-x-auto">
        <ValueView value={variable.value} />
        {variable.previous && variable.changed && (
          <div className="mt-0.5 text-xs text-faint">
            was <ValueView value={variable.previous} depth={9} />
          </div>
        )}
      </div>
    </div>
  );
}

function FrameCard({ frame, isTop }: { frame: FrameView; isTop: boolean }) {
  const { view } = useInspector();
  const data = frame.variables.filter((v) => !isCallable(v, view));
  const functions = frame.variables.filter((v) => isCallable(v, view));
  return (
    <section
      aria-label={`Frame ${frame.name}`}
      className={`rounded-lg border ${isTop ? "border-accent/50" : "border-border"} bg-surface`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-mono font-medium">
          {frame.name === "global" ? "Global" : `${frame.name}()`}
        </span>
        {frame.callLoc && <span className="text-faint">line {frame.callLoc.line}</span>}
      </header>
      <div className="p-1">
        {data.length === 0 && <p className="px-2 py-1.5 text-xs text-faint">No variables yet</p>}
        {data.map((variable) => (
          <VariableRow key={variable.binding} variable={variable} />
        ))}
        {functions.length > 0 && (
          <p className="px-2 py-1 text-xs text-faint">
            functions: <span className="font-mono">{functions.map((f) => f.name).join(", ")}</span>
          </p>
        )}
      </div>
    </section>
  );
}

/** Frames (innermost first) with their variables, plus closure-captured variables. */
export function VariablesPanel({ view }: { view: StepView }) {
  const frames = view.frames.toReversed();
  return (
    <InspectorProvider view={view}>
      <div className="flex flex-col gap-2">
        {frames.map((frame, index) => (
          <FrameCard key={frame.id} frame={frame} isTop={index === 0} />
        ))}
        {view.closures.length > 0 && (
          <section
            aria-label="Closures"
            className="rounded-lg border border-dashed border-border p-1"
          >
            <h3 className="px-2 py-1 text-xs text-faint">Captured by closures</h3>
            {view.closures.map((variable) => (
              <VariableRow key={variable.binding} variable={variable} />
            ))}
          </section>
        )}
      </div>
    </InspectorProvider>
  );
}
