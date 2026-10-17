import type {
  CompileRequest,
  CompilerWorkerMessage,
  ExecuteRequest,
  RuntimeRequest,
  RuntimeWorkerMessage,
  ServiceRequest,
  ServiceResponse,
  TestRequest,
} from "../core/protocol/messages";
import { encodeEvents } from "../core/protocol/eventCodec";
import type { RunOutcome } from "../core/protocol/limits";
import { browserModuleStore } from "../core/project/ModuleStore";
import { TraceRecorder } from "../core/runtime/TraceRecorder";
import { loadCompiler, loadRuntime, loadService } from "../languages/registry";
import type { LanguageRuntime } from "../languages/types";
import type { ProjectCompiler } from "./ProjectCompiler";

type Post<T> = (message: T) => void;
/** Posts a message, moving (not copying) the listed buffers to the receiver. */
type PostTransfer<T> = (message: T, transfer: ArrayBuffer[]) => void;
type Clock = () => number;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One project compiler per compiler worker, so scans and compiled modules are reused. */
let sharedProjects: Promise<ProjectCompiler> | null = null;
const sharedProjectCompiler = (): Promise<ProjectCompiler> => {
  sharedProjects ??= Promise.all([
    import("./ProjectCompiler"),
    import("../languages/projectHost"),
  ]).then(
    ([{ ProjectCompiler }, { projectHost }]) =>
      new ProjectCompiler(projectHost, browserModuleStore, crypto.randomUUID()),
  );
  return sharedProjects;
};

/** Compiler worker logic, independent of the worker global so it can be tested directly. */
export const handleCompile = async (
  request: CompileRequest,
  post: Post<CompilerWorkerMessage>,
  now: Clock,
  projects: () => Promise<ProjectCompiler> = sharedProjectCompiler,
): Promise<void> => {
  const started = now();
  try {
    if (request.project) {
      const compiler = await projects();
      post({ type: "ready", runId: request.runId });
      const result = await compiler.compile(request.project);
      post({ type: "compiled", runId: request.runId, result, compileMs: now() - started });
      return;
    }
    const compiler = await loadCompiler(request.languageId);
    if (!compiler) {
      post({
        type: "failure",
        runId: request.runId,
        message: `Unknown language: ${request.languageId}`,
      });
      return;
    }
    post({ type: "ready", runId: request.runId });
    const result = compiler.compile(request.source);
    post({ type: "compiled", runId: request.runId, result, compileMs: now() - started });
  } catch (error) {
    post({
      type: "failure",
      runId: request.runId,
      message: `Compiler crashed: ${errorText(error)}`,
    });
  }
};

/**
 * Answers one editor question from the language service. Never throws: a language without a
 * service, or a failing one, answers `null` and the editor carries on without it.
 */
export const handleService = async (
  request: ServiceRequest,
  post: Post<ServiceResponse>,
): Promise<void> => {
  let result: ServiceResponse["result"] = null;
  try {
    const service = await loadService(request.languageId);
    if (service) {
      service.update(request.source);
      const { call } = request;
      if (call.method === "diagnostics") result = service.diagnostics();
      else if (call.method === "complete") result = service.complete(call.pos, call.explicit);
      else result = service.hover(call.pos);
    }
  } catch {
    result = null;
  }
  post({ type: "service-result", id: request.id, result });
};

export interface RuntimeEnvironment {
  readonly post: PostTransfer<RuntimeWorkerMessage>;
  readonly now: Clock;
  /** Removes privileged globals right before user code runs (no-op in tests). */
  readonly lockdown: () => void;
}

/**
 * Loads the runtime for a request and reports `ready`, so the coordinator starts the
 * execution budget only once loading is done. Unknown languages and failed loads are
 * reported as failures.
 */
const runtimeFor = async (
  request: RuntimeRequest,
  env: RuntimeEnvironment,
): Promise<LanguageRuntime | null> => {
  const { runId, languageId } = request;
  const loading = loadRuntime(languageId);
  if (!loading) {
    env.post({ type: "failure", runId, message: `Unknown language: ${languageId}` }, []);
    return null;
  }
  try {
    const runtime = await loading;
    env.post({ type: "ready", runId }, []);
    return runtime;
  } catch (error) {
    env.post(
      {
        type: "failure",
        runId,
        message: `Could not load the ${languageId} runtime: ${errorText(error)}`,
      },
      [],
    );
    return null;
  }
};

const executeProject = (
  runtime: LanguageRuntime,
  entryUrl: string,
  recorder: TraceRecorder,
  limits: ExecuteRequest["limits"],
): Promise<RunOutcome> =>
  runtime.executeModule
    ? runtime.executeModule(entryUrl, recorder, limits)
    : Promise.reject(new Error(`${runtime.languageId} does not support multi-file projects.`));

/**
 * Runtime worker logic: executes one program and streams batched events. The worker is
 * single-use; the coordinator terminates it afterwards.
 */
export const handleExecute = async (
  request: ExecuteRequest,
  env: RuntimeEnvironment,
): Promise<void> => {
  const { runId } = request;
  const runtime = await runtimeFor(request, env);
  if (!runtime) return;
  const recorder = new TraceRecorder(request.limits, (events) => {
    const batch = encodeEvents(events);
    env.post({ type: "events", runId, batch }, [batch.buffer]);
  });
  env.lockdown();
  const started = env.now();
  let outcome;
  try {
    outcome = request.entryUrl
      ? await executeProject(runtime, request.entryUrl, recorder, request.limits)
      : runtime.execute(request.code, recorder, request.limits);
  } catch (error) {
    env.post({ type: "failure", runId, message: `Runtime crashed: ${errorText(error)}` }, []);
    return;
  }
  const executeMs = env.now() - started;
  recorder.close();
  env.post(
    { type: "done", runId, outcome, steps: recorder.steps, events: recorder.events, executeMs },
    [],
  );
};

/** Runs every test case in order, reporting each result as soon as it is known. */
export const handleTest = async (request: TestRequest, env: RuntimeEnvironment): Promise<void> => {
  const { runId, suite } = request;
  const runtime = await runtimeFor(request, env);
  if (!runtime) return;
  env.lockdown();
  const started = env.now();
  let steps = 0;
  for (const testCase of suite.cases) {
    let result;
    try {
      result = runtime.runTest(request.code, suite, testCase, request.limits);
    } catch (error) {
      env.post({ type: "failure", runId, message: `Runtime crashed: ${errorText(error)}` }, []);
      return;
    }
    steps += result.steps;
    env.post({ type: "test-result", runId, result }, []);
  }
  env.post(
    {
      type: "done",
      runId,
      outcome: { kind: "ok" },
      steps,
      events: 0,
      executeMs: env.now() - started,
    },
    [],
  );
};

export const handleRuntimeRequest = (
  request: RuntimeRequest,
  env: RuntimeEnvironment,
): Promise<void> =>
  request.type === "execute" ? handleExecute(request, env) : handleTest(request, env);
