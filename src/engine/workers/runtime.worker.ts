/// <reference lib="webworker" />
import {
  parseRuntimeRequest,
  parseWarmRequest,
  type RuntimeWorkerMessage,
} from "../core/protocol/messages";
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

let used = false;
scope.onmessage = (event: MessageEvent<unknown>) => {
  // Load the runtime the coordinator expects while the worker waits as the spare.
  const warm = parseWarmRequest(event.data);
  if (warm) {
    void loadRuntime(warm.languageId)?.catch(() => undefined);
    return;
  }
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
