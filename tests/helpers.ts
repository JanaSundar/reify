import type { TraceEvent } from "@/engine/core/protocol/events";
import {
  DEFAULT_LIMITS,
  type ExecutionLimits,
  type RunOutcome,
} from "@/engine/core/protocol/limits";
import type { ProgramInfo } from "@/engine/core/protocol/program";
import { TraceRecorder } from "@/engine/core/runtime/TraceRecorder";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";
import { JavaScriptRuntime } from "@/engine/languages/javascript/runtime/JavaScriptRuntime";
import { formatConsoleArgs, describeThrown } from "@/engine/languages/javascript/runtime/jsValues";

export const TEST_LIMITS: ExecutionLimits = { ...DEFAULT_LIMITS, batchSize: 64 };

export interface TracedRun {
  readonly program: ProgramInfo;
  readonly code: string;
  readonly events: TraceEvent[];
  readonly outcome: RunOutcome;
  readonly output: string[];
}

/** Compiles and executes a program in-process (no worker), collecting every event. */
export const trace = (
  source: string,
  options: { typescript?: boolean; limits?: Partial<ExecutionLimits> } = {},
): TracedRun => {
  const limits = { ...TEST_LIMITS, ...options.limits };
  const compiled = new JavaScriptCompiler(
    options.typescript ? "typescript" : "javascript",
    !!options.typescript,
  ).compile(source);
  if (!compiled.ok)
    throw new Error(`Compile failed: ${compiled.diagnostics.map((d) => d.message).join("; ")}`);
  const events: TraceEvent[] = [];
  const recorder = new TraceRecorder(limits, (batch) => events.push(...batch));
  const outcome = new JavaScriptRuntime("javascript").execute(compiled.code, recorder, limits);
  recorder.close();
  const output = events.flatMap((e) => (e.k === 9 ? [e.text] : []));
  return { program: compiled.program, code: compiled.code, events, outcome, output };
};

export interface PlainRun {
  readonly output: string[];
  readonly error: string | null;
}

/** Runs the type-stripped but uninstrumented program, for differential comparison. */
export const runPlain = (source: string, options: { typescript?: boolean } = {}): PlainRun => {
  const stripped = new JavaScriptCompiler("x", !!options.typescript);
  // Compile only to validate support; execute the original (types stripped by Babel separately).
  const ok = stripped.compile(source);
  if (!ok.ok) throw new Error("unsupported program");
  const output: string[] = [];
  const log = (...args: unknown[]) =>
    output.push(formatConsoleArgs(args, TEST_LIMITS.maxStringLength));
  const fakeConsole = { log, info: log, warn: log, error: log, debug: log };
  const code = options.typescript ? stripTypes(source) : source;
  try {
    new Function("console", code)(fakeConsole);
    return { output, error: null };
  } catch (error) {
    return { output, error: describeThrown(error) };
  }
};

import * as Babel from "@babel/standalone";
const stripTypes = (source: string): string =>
  Babel.transform(source, {
    filename: "a.ts",
    presets: [["typescript", {}]],
    sourceType: "script",
    configFile: false,
    babelrc: false,
  })!.code!;

/** Builds a store holding a complete trace. */
export const storeFor = (run: TracedRun, source = "", interval = 4): TraceStore => {
  const store = new TraceStore({ snapshotInterval: interval, schedule: (fn) => fn() });
  store.begin(1, run.program, source);
  store.append(1, run.events);
  store.finish(1, run.outcome, null);
  return store;
};
