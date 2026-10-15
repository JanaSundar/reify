"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { HeapId } from "@/engine/core/protocol/values";
import type { StepView } from "@/engine/core/trace/stepView";

interface InspectorState {
  readonly view: StepView;
  /** Heap identity the user is following; every occurrence is highlighted. */
  readonly selected: HeapId | null;
  readonly select: (id: HeapId | null) => void;
}

const InspectorContext = createContext<InspectorState | null>(null);

/** Local (non-global) UI state shared by the inspector's nested value views. */
export function InspectorProvider({ view, children }: { view: StepView; children: ReactNode }) {
  const [selected, setSelected] = useState<HeapId | null>(null);
  const value = useMemo(() => ({ view, selected, select: setSelected }), [view, selected]);
  return <InspectorContext value={value}>{children}</InspectorContext>;
}

export function useInspector(): InspectorState {
  const state = useContext(InspectorContext);
  if (!state) throw new Error("useInspector must be used inside <InspectorProvider>");
  return state;
}
