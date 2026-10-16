import {
  assertEvent,
  assign,
  fromCallback,
  sendTo,
  setup,
  type ActorRefFrom,
  type SnapshotFrom,
} from "xstate";
import type {
  ExecutionCoordinator,
  RunFailure,
  RunPhase,
  RunRequest,
} from "@/engine/core/coordinator/ExecutionCoordinator";
import type { StaticComplexity } from "@/engine/core/analysis/complexity";
import type { RunOutcome, RunStats } from "@/engine/core/protocol/limits";
import type { TestResult, TestSuite } from "@/engine/core/protocol/testing";

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
  /** Static analysis of the last compiled program. */
  readonly analysis: StaticComplexity | null;
  /** Results of the latest test run; kept while individual cases are traced. */
  readonly testResults: readonly TestResult[];
}

export type ExecutionEvent =
  | { type: "RUN"; source: string; languageId: string; suite?: TestSuite }
  | { type: "CANCEL" }
  | { type: "RESET" }
  | { type: "EXECUTION_COMPILED"; runId: number; analysis: StaticComplexity | null }
  | { type: "EXECUTION_TEST_RESULT"; runId: number; result: TestResult }
  | { type: "EXECUTION_PROGRESS"; runId: number; phase: RunPhase; steps: number; events: number }
  | { type: "EXECUTION_COMPLETE"; runId: number; outcome: RunOutcome; stats: RunStats }
  | { type: "EXECUTION_ERROR"; runId: number; failure: RunFailure }
  | { type: "EXECUTION_CANCELLED"; runId: number };

type WorkerEvent = Extract<ExecutionEvent, { runId: number }>;
type RunEvent = Extract<ExecutionEvent, { type: "RUN" }>;

/** The run request a RUN event asks for (the run id is assigned by the machine). */
const requestOf = ({ source, languageId, suite }: RunEvent): Omit<RunRequest, "runId"> => ({
  source,
  languageId,
  suite,
});

/** The invoked actor: bridges one run of the coordinator into machine events. */
export const createExecutionActor = (coordinator: ExecutionCoordinator) =>
  fromCallback<{ type: "CANCEL" }, RunRequest, WorkerEvent>(({ input, sendBack, receive }) => {
    const { runId } = input;
    const handle = coordinator.start(input, {
      onProgress: (progress) => sendBack({ type: "EXECUTION_PROGRESS", runId, ...progress }),
      onCompiled: (program) =>
        sendBack({ type: "EXECUTION_COMPILED", runId, analysis: program.complexity }),
      onTestResult: (result) => sendBack({ type: "EXECUTION_TEST_RESULT", runId, result }),
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
  analysis: null,
  testResults: [],
};

/** How long `cancelling` waits for the worker to acknowledge before giving up on it. */
export const CANCEL_GRACE_MS = 2_000;

/** RUN from any settled state starts a fresh run. */
const START_RUN = { RUN: { target: "active", actions: "startRun" } } as const;

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
      assertEvent(event, "RUN");
      return {
        ...INITIAL_CONTEXT,
        runId: context.runId + 1,
        request: requestOf(event),
        phase: "compiling" as const,
        analysis: context.analysis,
        testResults: event.suite ? [] : context.testResults,
      };
    }),
    resetContext: assign(({ context }) => ({ ...INITIAL_CONTEXT, runId: context.runId })),
    clearPhase: assign({ phase: null }),
    recordAnalysis: assign(({ event }) => {
      assertEvent(event, "EXECUTION_COMPILED");
      return { analysis: event.analysis };
    }),
    recordTestResult: assign(({ context, event }) => {
      assertEvent(event, "EXECUTION_TEST_RESULT");
      return { testResults: [...context.testResults, event.result] };
    }),
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
    idle: { on: START_RUN },
    active: {
      invoke: {
        id: "executor",
        src: "execution",
        // `active` is only entered through RUN; `startRun` has already assigned the run id.
        input: ({ context, event }) => {
          assertEvent(event, "RUN");
          return { runId: context.runId, ...requestOf(event) };
        },
      },
      // Leaving `active` (settled, reset or restarted) always ends the current phase.
      exit: "clearPhase",
      initial: "running",
      on: {
        EXECUTION_COMPILED: { guard: "isCurrentRun", actions: "recordAnalysis" },
        EXECUTION_TEST_RESULT: { guard: "isCurrentRun", actions: "recordTestResult" },
        EXECUTION_COMPLETE: {
          guard: "isCurrentRun",
          target: "completed",
          actions: assign(({ event }) => ({ outcome: event.outcome, stats: event.stats })),
        },
        EXECUTION_ERROR: {
          guard: "isCurrentRun",
          target: "failed",
          actions: assign(({ event }) => ({ failure: event.failure })),
        },
        EXECUTION_CANCELLED: { guard: "isCurrentRun", target: "cancelled" },
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
            [CANCEL_GRACE_MS]: { target: "#execution.cancelled" },
          },
        },
      },
    },
    completed: { on: START_RUN },
    failed: { on: START_RUN },
    cancelled: { on: START_RUN },
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

const SETTLED = ["idle", "completed", "failed", "cancelled"] as const;

export const statusOf = (snapshot: SnapshotFrom<typeof executionMachine>): ExecutionStatus => {
  if (snapshot.matches({ active: "cancelling" })) return "cancelling";
  if (snapshot.matches("active")) return "running";
  return SETTLED.find((state) => snapshot.matches(state)) ?? "idle";
};
