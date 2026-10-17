import type { WorkerFactories, WorkerLike } from "@/engine/core/coordinator/ExecutionCoordinator";
import { startModuleServer } from "@/lib/moduleServer";

/** Adapts a DOM `Worker` to the coordinator's minimal `WorkerLike` interface. */
const adapt = (worker: Worker): WorkerLike => {
  const like: WorkerLike = {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    onmessage: null,
    onerror: null,
  };
  worker.onmessage = (event) => like.onmessage?.({ data: event.data });
  worker.onerror = (event) => {
    event.preventDefault();
    like.onerror?.({ message: event.message });
  };
  worker.onmessageerror = () =>
    like.onerror?.({ message: "Received a message that could not be decoded." });
  return like;
};

export const browserWorkers: WorkerFactories = {
  moduleServer: startModuleServer,
  compiler: () =>
    adapt(
      new Worker(new URL("../../engine/workers/compiler.worker.ts", import.meta.url), {
        type: "module",
        name: "reify-compiler",
      }),
    ),
  runtime: () =>
    adapt(
      new Worker(new URL("../../engine/workers/runtime.worker.ts", import.meta.url), {
        type: "module",
        name: "reify-runtime",
      }),
    ),
};
