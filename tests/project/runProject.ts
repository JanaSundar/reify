import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { constants, Script } from "node:vm";
import { compileProject, type ProjectBuild } from "@/engine/core/project/compileProject";
import { buildGraph } from "@/engine/core/project/graph";
import type { TraceEvent } from "@/engine/core/protocol/events";
import type { RunOutcome } from "@/engine/core/protocol/limits";
import { TraceRecorder } from "@/engine/core/runtime/TraceRecorder";
import { JavaScriptRuntime } from "@/engine/languages/javascript/runtime/JavaScriptRuntime";
import { projectHost } from "@/engine/languages/projectHost";
import { TEST_LIMITS } from "../helpers";

/**
 * Node's own module loader. The test runner rewrites `import()` and `import` into its own
 * module system, which has no link errors or temporal dead zone; a `Function` body keeps the
 * real thing, the same engine behavior the browser provides.
 */
const nativeImport = new Script("(url) => import(url)", {
  importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
}).runInThisContext() as (url: string) => Promise<unknown>;

export interface ProjectRun {
  readonly build: ProjectBuild;
  readonly events: readonly TraceEvent[];
  readonly outcome: RunOutcome;
  readonly output: readonly string[];
}

/**
 * Builds a project and runs it as real native ES modules, written to a temporary directory
 * (the browser serves the same modules from the Cache API). Throws if the build fails.
 */
export const runProject = async (
  files: Record<string, string>,
  entry = "main.js",
): Promise<ProjectRun> => {
  const dir = mkdtempSync(join(tmpdir(), "reify-project-"));
  const fileOf = (path: string) => join(dir, `${path}.mjs`);
  try {
    const graph = buildGraph(
      { files: Object.entries(files).map(([path, source]) => ({ path, source })), entry },
      projectHost,
    );
    const built = compileProject(graph, (path) => pathToFileURL(fileOf(path)).href);
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    for (const { path, code } of built.build.modules) {
      mkdirSync(dirname(fileOf(path)), { recursive: true });
      writeFileSync(fileOf(path), code);
    }
    const events: TraceEvent[] = [];
    const recorder = new TraceRecorder(TEST_LIMITS, (batch) => events.push(...batch));
    const outcome = await new JavaScriptRuntime("javascript", nativeImport).executeModule(
      built.build.entryUrl,
      recorder,
      TEST_LIMITS,
    );
    recorder.close();
    const output = events.flatMap((e) => (e.k === 9 ? [e.text] : []));
    return { build: built.build, events, outcome, output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
