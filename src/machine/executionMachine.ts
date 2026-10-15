import { assign, fromCallback, sendTo, setup, type ActorRefFrom, type StateValue } from "xstate";
import type {
  ExecutionCoordinator,
  RunFailure,
  RunPhase,
  RunRequest,
} from "@/engine/core/coordinator/ExecutionCoordinator";
import type { RunOutcome, RunStats } from "@/engine/core/protocol/limits";

/**
 * Execution lifecycle — the single source of truth for "what is the run doing".
 * Bulk trace data never enters this machine; it flows from the coordinator straight into
 * the TraceStore. Every worker-originated event carries a run id and is ignored unless it
 * matches the current run.
 */

export interface ExecutionContext {
  readonly runId: number;
  readonly request: Omit<RunRequest, "runId"> | null;
  readonly phase: RunPhase | null;
  readonly steps: number;
  readonly events: number;
  readonly outcome: RunOutcome | null;
  readonly stats: RunStats | null;
  readonly failure: RunFailure | null;
}

export type ExecutionEvent =
  | { type: "RUN"; source: string; languageId: string }
  | { type: "CANCEL" }
  | { type: "RESET" }
  | { type: "EXECUTION_PROGRESS"; runId: number; phase: RunPhase; steps: number; events: number }
  | { type: "EXECUTION_COMPLETE"; runId: number; outcome: RunOutcome; stats: RunStats }
  | { type: "EXECUTION_ERROR"; runId: number; failure: RunFailure }
  | { type: "EXECUTION_CANCELLED"; runId: number };

type WorkerEvent = Extract<ExecutionEvent, { runId: number }>;

/** The invoked actor: bridges one run of the coordinator into machine events. */
export const createExecutionActor = (coordinator: ExecutionCoordinator) =>
  fromCallback<{ type: "CANCEL" }, RunRequest, WorkerEvent>(({ input, sendBack, receive }) => {
    const { runId } = input;
    const handle = coordinator.start(input, {
      onProgress: (progress) => sendBack({ type: "EXECUTION_PROGRESS", runId, ...progress }),
      onComplete: (outcome, stats) =>
        sendBack({ type: "EXECUTION_COMPLETE", runId, outcome, stats }),
      onError: (failure) => sendBack({ type: "EXECUTION_ERROR", runId, failure }),
      onCancelled: () => sendBack({ type: "EXECUTION_CANCELLED", runId }),
    });
    receive((event) => {
      if (event.type === "CANCEL") handle.cancel();
    });
    return () => handle.dispose();
  });

const INITIAL_CONTEXT: ExecutionContext = {
  runId: 0,
  request: null,
  phase: null,
  steps: 0,
  events: 0,
  outcome: null,
  stats: null,
  failure: null,
};

/** How long `cancelling` waits for the worker to acknowledge before giving up on it. */
export const CANCEL_GRACE_MS = 2_000;

export const executionMachine = setup({
  types: {
    context: {} as ExecutionContext,
    events: {} as ExecutionEvent,
  },
  actors: {
    // Replaced via `.provide()` with `createExecutionActor(coordinator)`.
    execution: fromCallback<{ type: "CANCEL" }, RunRequest, WorkerEvent>(() => undefined),
  },
  actions: {
    // Replaced via `.provide()` to clear the trace store.
    clearTrace: () => undefined,
    startRun: assign(({ context, event }) => {
      if (event.type !== "RUN") return {};
      return {
        ...INITIAL_CONTEXT,
        runId: context.runId + 1,
        request: { source: event.source, languageId: event.languageId },
        phase: "compiling" as const,
      };
    }),
    resetContext: assign(({ context }) => ({ ...INITIAL_CONTEXT, runId: context.runId })),
  },
  guards: {
    isCurrentRun: ({ context, event }) => "runId" in event && event.runId === context.runId,
  },
}).createMachine({
  id: "execution",
  initial: "idle",
  context: INITIAL_CONTEXT,
  on: {
    RESET: { target: ".idle", actions: ["clearTrace", "resetContext"] },
  },
  states: {
    idle: {
      on: { RUN: { target: "active", actions: "startRun" } },
    },
    active: {
      invoke: {
        id: "executor",
        src: "execution",
        input: ({ context }) => ({ runId: context.runId, ...context.request! }),
      },
      initial: "running",
      on: {
        EXECUTION_COMPLETE: {
          guard: "isCurrentRun",
          target: "completed",
          actions: assign(({ event }) => ({
            outcome: event.outcome,
            stats: event.stats,
            phase: null,
          })),
        },
        EXECUTION_ERROR: {
          guard: "isCurrentRun",
          target: "failed",
          actions: assign(({ event }) => ({ failure: event.failure, phase: null })),
        },
        EXECUTION_CANCELLED: {
          guard: "isCurrentRun",
          target: "cancelled",
          actions: assign({ phase: null }),
        },
      },
      states: {
        running: {
          on: {
            RUN: { target: "#execution.active", reenter: true, actions: "startRun" },
            CANCEL: { target: "cancelling", actions: sendTo("executor", { type: "CANCEL" }) },
            EXECUTION_PROGRESS: {
              guard: "isCurrentRun",
              actions: assign(({ event }) => ({
                phase: event.phase,
                steps: event.steps,
                events: event.events,
              })),
            },
          },
        },
        cancelling: {
          after: {
            [CANCEL_GRACE_MS]: { target: "#execution.cancelled", actions: assign({ phase: null }) },
          },
        },
      },
    },
    completed: {
      on: { RUN: { target: "active", actions: "startRun" } },
    },
    failed: {
      on: { RUN: { target: "active", actions: "startRun" } },
    },
    cancelled: {
      on: { RUN: { target: "active", actions: "startRun" } },
    },
  },
});

export type ExecutionActor = ActorRefFrom<typeof executionMachine>;

/** Status derived from the machine snapshot, for the UI. */
export type ExecutionStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export const statusOf = (value: StateValue): ExecutionStatus => {
  if (typeof value === "string") return value as ExecutionStatus;
  return (value as { active?: string }).active === "cancelling" ? "cancelling" : "running";
};
