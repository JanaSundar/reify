import { wrap } from "comlink";
import type { LanguageServiceClient } from "@/engine/core/protocol/languageService";
import type { ServiceCall, ServiceResponse } from "@/engine/core/protocol/messages";
import type { Diagnostic } from "@/engine/core/protocol/program";
import type { LanguageId } from "@/engine/languages/catalog";
import type { TypeScriptFamilyId } from "@/engine/languages/javascript/typecheck/environment";
import type { TypeScriptHost } from "@/engine/languages/javascript/service/host";

/**
 * Asks the compiler worker a question about a document (the execution session provides it).
 * Resolves `null` when the language has no service there or the worker went away.
 */
export type ServiceTransport = (
  languageId: string,
  source: string,
  call: ServiceCall,
) => Promise<ServiceResponse["result"]>;

/**
 * Main-thread side of the language services. JavaScript and TypeScript share a worker of
 * their own, created the first time one of them is opened. Other languages ask the compiler
 * worker, whose runtime is already loaded for running code. Languages without a service
 * return null and keep the editor's built-in word completion.
 */

const typeScriptHost = (() => {
  let host: { readonly remote: ReturnType<typeof wrap<TypeScriptHost>>; ready: Promise<void> };
  return () => {
    if (!host) {
      const remote = wrap<TypeScriptHost>(
        new Worker(new URL("../../engine/workers/typescript.worker.ts", import.meta.url), {
          type: "module",
          name: "reify-typescript",
        }),
      );
      host = { remote, ready: remote.initialize() };
    }
    return host;
  };
})();

const typeScriptClient = (languageId: TypeScriptFamilyId): LanguageServiceClient => {
  const { remote, ready } = typeScriptHost();
  return {
    ready,
    update: (source) => void remote.update(languageId, source),
    diagnostics: () => remote.diagnostics(languageId),
    complete: (pos, explicit) => remote.complete(languageId, pos, explicit),
    hover: (pos) => remote.hover(languageId, pos),
  };
};

/** A service reached through the compiler worker; the worker answers from the document sent. */
const workerClient = (languageId: LanguageId, ask: ServiceTransport): LanguageServiceClient => {
  let source = "";
  return {
    ready: Promise.resolve(),
    update: (next) => {
      source = next;
    },
    diagnostics: async () =>
      ((await ask(languageId, source, { method: "diagnostics" })) as
        | readonly Diagnostic[]
        | null) ?? [],
    complete: async (pos, explicit) =>
      (await ask(languageId, source, { method: "complete", pos, explicit })) as Awaited<
        ReturnType<LanguageServiceClient["complete"]>
      >,
    hover: async (pos) =>
      (await ask(languageId, source, { method: "hover", pos })) as Awaited<
        ReturnType<LanguageServiceClient["hover"]>
      >,
  };
};

const CLIENTS: Partial<Record<LanguageId, (ask: ServiceTransport) => LanguageServiceClient>> = {
  javascript: () => typeScriptClient("javascript"),
  typescript: () => typeScriptClient("typescript"),
  python: (ask) => workerClient("python", ask),
};

export const languageServiceFor = (
  languageId: LanguageId,
  ask: ServiceTransport,
): LanguageServiceClient | null => CLIENTS[languageId]?.(ask) ?? null;
