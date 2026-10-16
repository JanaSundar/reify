import type { PyodideAPI } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { version } from "pyodide/package.json";

/**
 * Where the self-hosted runtime lives: `scripts/copy-pyodide.mjs` copies it to
 * `public/pyodide/<version>/` and `next.config.ts` serves that path as immutable.
 */
export const PYODIDE_INDEX_URL = `/pyodide/${version}/`;

type WorkerScope = { importScripts?: unknown };

/**
 * Runs `load` with `importScripts` hidden. Turbopack runs `type: "module"` workers as
 * classic scripts (its chunks load through `importScripts`), and Pyodide refuses to start
 * when it can call `importScripts`. Hiding it is safe once this worker's chunks have loaded;
 * `lockdownGlobals` removes it for good before user code runs.
 */
export const withoutImportScripts = async <T>(
  scope: WorkerScope,
  load: () => Promise<T>,
): Promise<T> => {
  const saved = scope.importScripts;
  scope.importScripts = undefined;
  try {
    return await load();
  } finally {
    scope.importScripts = saved;
  }
};

/** Loads Pyodide from the self-hosted copy (not bundled: it fetches its wasm and stdlib). */
export const loadPyodideRuntime = (scope: WorkerScope = globalThis): Promise<PyodideAPI> =>
  withoutImportScripts(scope, async () => {
    const { loadPyodide } = (await import(
      /* turbopackIgnore: true */ /* webpackIgnore: true */ `${PYODIDE_INDEX_URL}pyodide.mjs`
    )) as typeof import("pyodide");
    return loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  });

/** Where Reify's own Python modules are installed inside Pyodide's file system. */
const MODULE_DIR = "/reify";

/**
 * Installs a Python module from source so it can be imported, and returns it. Modules are
 * plain files in Pyodide's in-memory file system (nothing is fetched).
 */
export const installPythonModule = (pyodide: PyodideAPI, name: string, source: string): PyProxy => {
  pyodide.FS.mkdirTree(MODULE_DIR);
  pyodide.FS.writeFile(`${MODULE_DIR}/${name}.py`, source);
  pyodide.runPython(
    `import sys\nif ${JSON.stringify(MODULE_DIR)} not in sys.path: sys.path.insert(0, ${JSON.stringify(MODULE_DIR)})`,
  );
  return pyodide.pyimport(name);
};
