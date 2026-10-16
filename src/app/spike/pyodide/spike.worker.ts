/// <reference lib="webworker" />
import type { PyodideAPI } from "pyodide";
import type { PyBuffer } from "pyodide/ffi";
import { version } from "pyodide/package.json";
import { PLAIN_FIB, TRACED_FIB, TRACER, type SpikeMessage } from "./spikeProgram";

/** Phase 0 spike: loads self-hosted Pyodide, then times plain and traced `fib(n)`. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: SpikeMessage): void => scope.postMessage(message);
const started = performance.now();
const INDEX_URL = `/pyodide/${version}/`;

/**
 * Turbopack runs `type: "module"` workers as classic scripts (chunks load with
 * `importScripts`), and Pyodide refuses classic workers by probing `importScripts`. Hide it
 * while Pyodide loads; Turbopack has already loaded this worker's chunks by then.
 */
const withoutImportScripts = async <T>(load: () => Promise<T>): Promise<T> => {
  const global = scope as unknown as { importScripts: unknown };
  const saved = global.importScripts;
  global.importScripts = undefined;
  try {
    return await load();
  } finally {
    global.importScripts = saved;
  }
};

const load = (): Promise<PyodideAPI> =>
  withoutImportScripts(async () => {
    // Served from public/, not bundled: Pyodide resolves its wasm and stdlib from indexURL.
    const { loadPyodide } = (await import(
      /* turbopackIgnore: true */ /* webpackIgnore: true */ `${INDEX_URL}pyodide.mjs`
    )) as typeof import("pyodide");
    return loadPyodide({ indexURL: INDEX_URL });
  });

const ready = load().then((py) => {
  post({ type: "ready", loadMs: performance.now() - started });
  return py;
});
ready.catch((error: unknown) => post({ type: "error", message: String(error) }));

scope.onmessage = async (event: MessageEvent<{ n: number; maxSteps: number }>) => {
  const { n, maxSteps } = event.data;
  const py = await ready;
  const loadMs = performance.now() - started;
  try {
    let words = 0;
    py.globals.set("flush_js", (array: PyBuffer) => {
      const view = array.getBuffer("i32");
      words += view.data.length;
      view.release();
      array.destroy();
    });
    py.runPython(TRACER);

    py.runPython(PLAIN_FIB);
    let at = performance.now();
    py.runPython(`fib(${n})`);
    const plainMs = performance.now() - at;

    py.runPython(TRACED_FIB);
    py.runPython(`__r = WordTracer(flush_js, ${maxSteps}, 16384)`);
    at = performance.now();
    py.runPython(`fib(${n}); __r.flush()`);
    const tracedMs = performance.now() - at;
    const steps = py.runPython("__r.steps") as number;

    py.runPython(`__r = WordTracer(flush_js, 1000, 16384)`);
    const limitEscapes = py.runPython(`
def guarded():
    try:
        return fib(${n})
    except Exception:
        return "swallowed"
try:
    guarded()
    escaped = False
except ReifyLimit:
    escaped = True
escaped
`) as boolean;

    post({ type: "result", loadMs, plainMs, tracedMs, words, steps, limitEscapes });
  } catch (error) {
    post({ type: "error", message: String(error) });
  }
};
