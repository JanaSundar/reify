import type {
  CompileRequest,
  CompilerWorkerMessage,
  ExecuteRequest,
  RuntimeWorkerMessage,
} from "../core/protocol/messages";
import { encodeEvents } from "../core/protocol/eventCodec";
import { TraceRecorder } from "../core/runtime/TraceRecorder";
import { loadCompiler, loadRuntime } from "../languages/registry";

type Post<T> = (message: T) => void;
/** Posts a message, moving (not copying) the listed buffers to the receiver. */
type PostTransfer<T> = (message: T, transfer: ArrayBuffer[]) => void;
type Clock = () => number;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Compiler worker logic, independent of the worker global so it can be tested directly. */
export const handleCompile = async (
  request: CompileRequest,
  post: Post<CompilerWorkerMessage>,
  now: Clock,
): Promise<void> => {
  const started = now();
  try {
    const compiler = await loadCompiler(request.languageId);
    if (!compiler) {
      post({
        type: "failure",
        runId: request.runId,
        message: `Unknown language: ${request.languageId}`,
      });
      return;
    }
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

export interface RuntimeEnvironment {
  readonly post: PostTransfer<RuntimeWorkerMessage>;
  readonly now: Clock;
  /** Removes privileged globals right before user code runs (no-op in tests). */
  readonly lockdown: () => void;
}

/**
 * Runtime worker logic: executes one program and streams batched events. The worker is
 * single-use; the coordinator terminates it afterwards.
 */
export const handleExecute = async (
  request: ExecuteRequest,
  env: RuntimeEnvironment,
): Promise<void> => {
  const { runId } = request;
  const runtime = await loadRuntime(request.languageId)?.catch(() => null);
  if (!runtime) {
    env.post({ type: "failure", runId, message: `Unknown language: ${request.languageId}` }, []);
    return;
  }
  const recorder = new TraceRecorder(request.limits, (events) => {
    const batch = encodeEvents(events);
    env.post({ type: "events", runId, batch }, [batch.buffer]);
  });
  env.lockdown();
  const started = env.now();
  let outcome;
  try {
    outcome = runtime.execute(request.code, recorder, request.limits);
  } catch (error) {
    env.post({ type: "failure", runId, message: `Runtime crashed: ${errorText(error)}` }, []);
    return;
  }
  const executeMs = env.now() - started;
  recorder.close();
  env.post(
    {
      type: "done",
      runId,
      outcome,
      steps: recorder.steps,
      events: recorder.events,
      executeMs,
    },
    [],
  );
};
