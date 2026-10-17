import type { LanguageId } from "./catalog";
import type { PyodideAPI } from "pyodide";
import type { LanguageService } from "../core/protocol/languageService";
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

/** One Pyodide per worker, shared by the Python compiler and the Python language service. */
let pyodide: Promise<PyodideAPI> | null = null;
const sharedPyodide = (): Promise<PyodideAPI> => {
  if (!pyodide) {
    pyodide = import("./python/pyodide").then(({ loadPyodideRuntime }) => loadPyodideRuntime());
    // A failed load (e.g. a network error) is retried next time.
    pyodide.catch(() => (pyodide = null));
  }
  return pyodide;
};

const pythonCompiler: Factory<LanguageCompiler> = async (languageId) => {
  const { PythonCompiler } = await import("./python/compiler/PythonCompiler");
  return PythonCompiler.create(languageId, await sharedPyodide());
};

const pythonService: Factory<LanguageService> = async () => {
  const { PythonService } = await import("./python/service/PythonService");
  return PythonService.create(await sharedPyodide());
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

/** Languages with editor intelligence in the compiler worker (the rest run elsewhere). */
const SERVICES: Readonly<Partial<Record<LanguageId, Factory<LanguageService>>>> = {
  python: pythonService,
};

const memoize = <T>(factories: Readonly<Partial<Record<LanguageId, Factory<T>>>>) => {
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
export const loadService = memoize(SERVICES);
