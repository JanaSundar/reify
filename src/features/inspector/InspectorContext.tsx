"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { HeapId } from "@/engine/core/protocol/values";
import {
  inboundReferences,
  variablesByObject,
  visibleFrames,
} from "@/engine/core/trace/references";
import type { StepView } from "@/engine/core/trace/stepView";

interface InspectorState {
  readonly view: StepView;
  /** Heap identity the user is following; every occurrence is highlighted. */
  readonly selected: HeapId | null;
  /** Follows an object, or stops following it if it is already followed. */
  readonly toggle: (id: HeapId) => void;
  /** Names of the visible variables (global and current frame) that reference each object. */
  readonly pointers: ReadonlyMap<HeapId, readonly string[]>;
  /** Number of references to each object, from variables and other objects. */
  readonly inbound: ReadonlyMap<HeapId, number>;
}

const InspectorContext = createContext<InspectorState | null>(null);

/** Local (non-global) UI state shared by the inspector's nested value views. */
export function InspectorProvider({ view, children }: { view: StepView; children: ReactNode }) {
  const [selected, setSelected] = useState<HeapId | null>(null);
  const derived = useMemo(
    () => ({
      pointers: variablesByObject(visibleFrames(view)),
      inbound: inboundReferences(view),
    }),
    [view],
  );
  const value = useMemo(
    () => ({
      view,
      selected,
      toggle: (id: HeapId) => setSelected((current) => (current === id ? null : id)),
      ...derived,
    }),
    [view, selected, derived],
  );
  return <InspectorContext value={value}>{children}</InspectorContext>;
}

export function useInspector(): InspectorState {
  const state = useContext(InspectorContext);
  if (!state) throw new Error("useInspector must be used inside <InspectorProvider>");
  return state;
}
