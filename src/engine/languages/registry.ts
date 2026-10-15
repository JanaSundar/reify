import type { LanguageCompiler, LanguageRuntime } from "./types";

/**
 * Worker-side language registry. Compilers and runtimes are created lazily inside their
 * workers so unused languages cost nothing. Add a language here and in `catalog.ts`.
 */

type Factory<T> = (languageId: string) => Promise<T>;

const javascriptCompiler: Factory<LanguageCompiler> = async (languageId) => {
  const { JavaScriptCompiler } = await import("./javascript/compiler/JavaScriptCompiler");
  return new JavaScriptCompiler(languageId, languageId === "typescript");
};

const javascriptRuntime: Factory<LanguageRuntime> = async (languageId) => {
  const { JavaScriptRuntime } = await import("./javascript/runtime/JavaScriptRuntime");
  return new JavaScriptRuntime(languageId);
};

const COMPILERS: Readonly<Record<string, Factory<LanguageCompiler>>> = {
  javascript: javascriptCompiler,
  typescript: javascriptCompiler,
};

const RUNTIMES: Readonly<Record<string, Factory<LanguageRuntime>>> = {
  javascript: javascriptRuntime,
  typescript: javascriptRuntime,
};

const memoize = <T>(factories: Readonly<Record<string, Factory<T>>>) => {
  const cache = new Map<string, Promise<T>>();
  return (languageId: string): Promise<T> | null => {
    const factory = factories[languageId];
    if (!factory) return null;
    let instance = cache.get(languageId);
    if (!instance) {
      instance = factory(languageId);
      cache.set(languageId, instance);
    }
    return instance;
  };
};

export const loadCompiler = memoize(COMPILERS);
export const loadRuntime = memoize(RUNTIMES);
