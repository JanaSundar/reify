/// <reference lib="webworker" />
import {
  parseCompileRequest,
  parseServiceRequest,
  parseWarmRequest,
  type CompilerWorkerMessage,
  type ServiceResponse,
} from "../core/protocol/messages";
import { loadCompiler } from "../languages/registry";
import { handleCompile, handleService } from "./handlers";

/** Long-lived worker: parses and instruments source code. Never runs user code. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: CompilerWorkerMessage | ServiceResponse): void => scope.postMessage(message);

scope.onmessage = (event: MessageEvent<unknown>) => {
  // Load a language's compiler (e.g. Pyodide for Python) before the first compile needs it.
  const warm = parseWarmRequest(event.data);
  if (warm) {
    void loadCompiler(warm.languageId)?.catch(() => undefined);
    return;
  }
  const question = parseServiceRequest(event.data);
  if (question) {
    void handleService(question, post);
    return;
  }
  const request = parseCompileRequest(event.data);
  if (request) void handleCompile(request, post, () => performance.now());
};
