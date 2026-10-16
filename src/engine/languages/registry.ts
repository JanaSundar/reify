import type { LanguageId } from "./catalog";
import type { LanguageCompiler, LanguageRuntime } from "./types";

/**
 * Worker-side language registry. Compilers and runtimes are created lazily inside their
 * workers so unused languages cost nothing. Every language in `catalog.ts` has an entry.
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

const pythonCompiler: Factory<LanguageCompiler> = async (languageId) => {
  const [{ PythonCompiler }, { loadPyodideRuntime }] = await Promise.all([
    import("./python/compiler/PythonCompiler"),
    import("./python/pyodide"),
  ]);
  return PythonCompiler.create(languageId, await loadPyodideRuntime());
};

const pythonRuntime: Factory<LanguageRuntime> = async (languageId) => {
  const { PythonRuntime } = await import("./python/runtime/PythonRuntime");
  return PythonRuntime.load(languageId);
};

const COMPILERS: Readonly<Record<LanguageId, Factory<LanguageCompiler>>> = {
  javascript: javascriptCompiler,
  typescript: javascriptCompiler,
  python: pythonCompiler,
};

const RUNTIMES: Readonly<Record<LanguageId, Factory<LanguageRuntime>>> = {
  javascript: javascriptRuntime,
  typescript: javascriptRuntime,
  python: pythonRuntime,
};

const memoize = <T>(factories: Readonly<Record<LanguageId, Factory<T>>>) => {
  const cache = new Map<string, Promise<T>>();
  return (languageId: string): Promise<T> | null => {
    const factory = Object.hasOwn(factories, languageId)
      ? factories[languageId as LanguageId]
      : undefined;
    if (!factory) return null;
    let instance = cache.get(languageId);
    if (!instance) {
      instance = factory(languageId);
      cache.set(languageId, instance);
      // A failed load (e.g. a network error fetching a runtime) is retried next time.
      instance.catch(() => cache.delete(languageId));
    }
    return instance;
  };
};

export const loadCompiler = memoize(COMPILERS);
export const loadRuntime = memoize(RUNTIMES);
