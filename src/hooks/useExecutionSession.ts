"use client";

import { useActorRef, useSelector } from "@xstate/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ExecutionCoordinator } from "@/engine/core/coordinator/ExecutionCoordinator";
import { TraceStore, type TraceSnapshot } from "@/engine/core/trace/TraceStore";
import { browserWorkers } from "@/features/workspace/browserWorkers";
import {
  createExecutionActor,
  executionMachine,
  statusOf,
  type ExecutionActor,
  type ExecutionContext,
  type ExecutionStatus,
} from "@/machine/executionMachine";

/**
 * Coalesces store notifications to the next frame, with a timer fallback because
 * `requestAnimationFrame` is paused while the page is hidden.
 */
const nextFrame = (callback: () => void): void => {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    callback();
  };
  requestAnimationFrame(run);
  setTimeout(run, 50);
};

export interface ExecutionSession {
  readonly store: TraceStore;
  readonly actor: ExecutionActor;
  /** Starts workers for the next run in `languageId` (stable across renders). */
  readonly prewarm: (languageId: string) => void;
}

/**
 * Wires the four state owners together for one workspace: the trace store (history), the
 * coordinator (workers), and the XState actor (lifecycle). Created once per mount.
 */
export function useExecutionSession(): ExecutionSession {
  const [services] = useState(() => {
    const store = new TraceStore({ schedule: nextFrame });
    const coordinator = new ExecutionCoordinator(browserWorkers, store);
    const machine = executionMachine.provide({
      actors: { execution: createExecutionActor(coordinator) },
      actions: { clearTrace: () => store.clear() },
    });
    const prewarm = (languageId: string) => coordinator.prewarm(languageId);
    return { store, coordinator, machine, prewarm };
  });
  const actor = useActorRef(services.machine);

  useEffect(() => () => services.coordinator.dispose(), [services]);

  return { store: services.store, actor, prewarm: services.prewarm };
}

export function useTraceSnapshot(store: TraceStore): TraceSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useExecutionStatus(actor: ExecutionActor): ExecutionStatus {
  return useSelector(actor, (snapshot) => statusOf(snapshot));
}

export function useExecutionContext(actor: ExecutionActor): ExecutionContext {
  return useSelector(actor, (snapshot) => snapshot.context);
}
