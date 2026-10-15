/// <reference lib="webworker" />
import { parseCompileRequest, type CompilerWorkerMessage } from "../core/protocol/messages";
import { handleCompile } from "./handlers";

/** Long-lived worker: parses and instruments source code. Never runs user code. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: CompilerWorkerMessage): void => scope.postMessage(message);

scope.onmessage = (event: MessageEvent<unknown>) => {
  const request = parseCompileRequest(event.data);
  if (request) void handleCompile(request, post, () => performance.now());
};
