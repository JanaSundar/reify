import { loadPyodide, type PyodideAPI } from "pyodide";
import type { CompileResult } from "@/engine/core/protocol/messages";
import { DEFAULT_LIMITS, type ExecutionLimits } from "@/engine/core/protocol/limits";
import type { TraceEvent } from "@/engine/core/protocol/events";
import type { RunOutcome } from "@/engine/core/protocol/limits";
import type { ProgramInfo } from "@/engine/core/protocol/program";
import { TraceRecorder } from "@/engine/core/runtime/TraceRecorder";
import { TraceStore } from "@/engine/core/trace/TraceStore";
import type { StepView } from "@/engine/core/trace/stepView";
import { PythonCompiler } from "@/engine/languages/python/compiler/PythonCompiler";
import { PythonRuntime } from "@/engine/languages/python/runtime/PythonRuntime";

/** Pyodide loads in about a second under Node; share one instance per test file. */
let shared: Promise<PyodideAPI> | null = null;
export const testPyodide = (): Promise<PyodideAPI> => (shared ??= loadPyodide());

export const PYODIDE_TIMEOUT_MS = 60_000;

export const compilerFor = async (): Promise<PythonCompiler> =>
  PythonCompiler.create("python", await testPyodide());

/**
 * A tracer whose hooks do nothing but keep the program's behaviour: the reference for
 * "instrumentation must not change what the program does".
 */
const NOOP_TRACER = `
import builtins as _builtins

class NoopTracer:
    BaseException = _builtins.BaseException
    def ln(self, loc): pass
    def lt(self, loc, test): return test
    def br(self, loc, test): return test
    def en(self, *args): pass
    def rt(self, loc, value): return value
    def ex(self, loc, error): pass
    def lv(self): pass
    def a(self, *args): pass
    def ao(self, *args): pass
    def a1(self, loc, binding, value): return value
    def w(self, loc, obj, key): pass
    def m(self, loc, obj, method): return getattr(obj, method)
    def mf(self, loc, fn): return fn
    def mk(self, loc, obj, op): pass
    def ck(self, loc, binding, error): pass
    def dr(self, *args): pass
`;

/** Runs `code` in a fresh namespace and returns what it printed (and how it failed). */
const RUNNER = `
import contextlib as _contextlib, io as _io

def run_program(code, instrumented):
    out = _io.StringIO()
    namespace = {"__name__": "__main__"}
    if instrumented:
        namespace["__reify__"] = NoopTracer()
    with _contextlib.redirect_stdout(out):
        try:
            exec(compile(code, "<program>", "exec"), namespace)
        except Exception as error:
            print("raised", type(error).__name__, error)
    return out.getvalue()
`;

let runnerReady = false;

/** Output of the plain program and of its instrumented form (under the no-op tracer). */
export const runBoth = async (
  source: string,
  compiled: Extract<CompileResult, { ok: true }>,
): Promise<{ plain: string; instrumented: string }> => {
  const pyodide = await testPyodide();
  if (!runnerReady) {
    pyodide.runPython(NOOP_TRACER + RUNNER);
    runnerReady = true;
  }
  const run = pyodide.globals.get("run_program") as (code: string, traced: boolean) => string;
  return { plain: run(source, false), instrumented: run(compiled.code, true) };
};

export const PYTHON_TEST_LIMITS: ExecutionLimits = { ...DEFAULT_LIMITS, batchSize: 64 };

export interface PythonRun {
  readonly program: ProgramInfo;
  readonly events: TraceEvent[];
  readonly outcome: RunOutcome;
  readonly output: string[];
  readonly steps: number;
}

let runtime: PythonRuntime | null = null;
/** The runtime locks its Pyodide down, so create it after the compiler. */
export const runtimeFor = async (): Promise<PythonRuntime> =>
  (runtime ??= PythonRuntime.create("python", await testPyodide()));

/** Compiles and traces a Python program in-process, collecting every event. */
export const tracePython = async (
  compiler: PythonCompiler,
  source: string,
  limits: Partial<ExecutionLimits> = {},
): Promise<PythonRun> => {
  const all = { ...PYTHON_TEST_LIMITS, ...limits };
  const compiled = compiler.compile(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const events: TraceEvent[] = [];
  const recorder = new TraceRecorder(all, (batch) => events.push(...batch));
  const outcome = (await runtimeFor()).execute(compiled.code, recorder, all);
  recorder.close();
  const output = events.flatMap((e) => (e.k === 9 ? [e.text] : []));
  return { program: compiled.program, events, outcome, output, steps: recorder.steps };
};

/** Every step view of a traced run, replayed through the real trace store. */
export const viewsOf = (run: PythonRun): StepView[] => {
  const store = new TraceStore({ snapshotInterval: 4, schedule: (fn) => fn() });
  store.begin(1, run.program, "");
  store.append(1, run.events);
  store.finish(1, run.outcome, null);
  const views: StepView[] = [];
  for (let i = 0; i < store.stepCount; i++) {
    store.seek(i);
    views.push(store.getSnapshot().view!);
  }
  return views;
};
