/// <reference lib="webworker" />
import { parseRuntimeRequest, type RuntimeWorkerMessage } from "../core/protocol/messages";
import { lockdownGlobals } from "../core/runtime/lockdown";
import { loadRuntime } from "../languages/registry";
import { handleRuntimeRequest } from "./handlers";

/**
 * Single-use worker that executes one instrumented program. Capabilities used by the
 * harness are captured before user code runs; privileged globals are then removed.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const postMessage = scope.postMessage.bind(scope);
const now = performance.now.bind(performance);

// Warm up the default runtime while the worker sits in the pool.
void loadRuntime("javascript");

let used = false;
scope.onmessage = (event: MessageEvent<unknown>) => {
  const request = parseRuntimeRequest(event.data);
  if (!request || used) return;
  used = true;
  void handleRuntimeRequest(request, {
    post: (message: RuntimeWorkerMessage, transfer: ArrayBuffer[]) =>
      postMessage(message, transfer),
    now,
    lockdown: () => lockdownGlobals(scope),
  });
};
