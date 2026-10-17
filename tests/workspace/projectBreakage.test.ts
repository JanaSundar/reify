import { describe, expect, it } from "vitest";
import { buildGraph } from "@/engine/core/project/graph";
import { projectHost } from "@/engine/languages/projectHost";
import {
  initialWorkspace,
  resolveDoc,
  workspaceReducer,
  type WorkspaceState,
} from "@/features/workspace/files";
import { planRun } from "@/features/workspace/runPlan";

/** A workspace of just these files (`id` = path), with `entry` as the pinned entry point. */
const workspace = (files: Record<string, string>, entry: string): WorkspaceState => {
  let state: WorkspaceState = { ...initialWorkspace(), files: [] };
  for (const [path, source] of Object.entries(files))
    state = workspaceReducer(state, { type: "create", id: path, name: path, source });
  return workspaceReducer(state, { type: "entry", id: entry });
};

/** What Run would build for the workspace, as diagnostics `code@path:line`. */
const problems = (state: WorkspaceState): string[] => {
  const plan = planRun(state, resolveDoc(state, state.active)?.source ?? "")!;
  const graph = buildGraph(plan.project!, projectHost);
  return graph.diagnostics.map((d) => `${d.code}@${d.path}:${d.range?.line ?? "-"}`);
};

const FILES = {
  "main.js": 'import { add } from "./lib/math.js";\nconsole.log(add(1, 2));',
  "lib/math.js": "export const add = (a, b) => a + b;",
};

describe("a project that works", () => {
  it("has no problems", () => {
    expect(problems(workspace(FILES, "main.js"))).toEqual([]);
  });
});

describe("edits that break imports are reported, never run around", () => {
  it("renaming an imported file breaks the import that names it", () => {
    const renamed = workspaceReducer(workspace(FILES, "main.js"), {
      type: "rename",
      id: "lib/math.js",
      name: "lib/maths.js",
    });
    expect(problems(renamed)).toEqual(["missing-module@main.js:1"]);
  });

  it("moving a folder breaks every import into it", () => {
    const moved = workspaceReducer(workspace(FILES, "main.js"), {
      type: "renameFolder",
      from: "lib",
      to: "src",
    });
    expect(problems(moved)).toEqual(["missing-module@main.js:1"]);
  });

  it("deleting an imported file breaks the import", () => {
    const deleted = workspaceReducer(workspace(FILES, "main.js"), {
      type: "delete",
      id: "lib/math.js",
    });
    expect(problems(deleted)).toEqual(["missing-module@main.js:1"]);
  });

  it("deleting the entry point leaves nothing pinned, so Run uses the open file", () => {
    const state = workspaceReducer(workspace(FILES, "main.js"), { type: "delete", id: "main.js" });
    expect(state.entry).toBeNull();
  });

  it("renaming a file back repairs the project", () => {
    let state = workspace(FILES, "main.js");
    state = workspaceReducer(state, { type: "rename", id: "lib/math.js", name: "lib/x.js" });
    state = workspaceReducer(state, { type: "rename", id: "lib/math.js", name: "lib/math.js" });
    expect(problems(state)).toEqual([]);
  });
});

describe("imports of names a module does not export", () => {
  const exportsOf = (source: string, importLine = 'import { a } from "./m.js";') =>
    problems(workspace({ "main.js": `${importLine}\n`, "m.js": source }, "main.js"));

  it("is reported at the import, before anything runs", () => {
    expect(exportsOf("export const b = 1;")).toEqual(["missing-export@main.js:1"]);
  });

  it("accepts every way of exporting a name", () => {
    const sources = [
      "export const a = 1;",
      "export function a() {}",
      "export class a {}",
      "const x = 1; export { x as a };",
      "export const { a } = {};",
    ];
    expect(sources.map((source) => exportsOf(source))).toEqual(sources.map(() => []));
    // Re-exports count too (the other file is missing, which is reported instead).
    for (const source of ['export { a } from "./other.js";', 'export * as a from "./other.js";'])
      expect(exportsOf(source)).toEqual(["missing-module@m.js:1"]);
  });

  it("checks default imports against `export default`", () => {
    expect(exportsOf("export const a = 1;", 'import d from "./m.js";')).toEqual([
      "missing-export@main.js:1",
    ]);
    expect(exportsOf("export default 1;", 'import d from "./m.js";')).toEqual([]);
  });

  it("follows `export *`, but never for the default export", () => {
    const files = {
      "main.js": 'import { a } from "./barrel.js";\nimport d from "./barrel.js";',
      "barrel.js": 'export * from "./m.js";',
      "m.js": "export const a = 1; export default 2;",
    };
    expect(problems(workspace(files, "main.js"))).toEqual(["missing-export@main.js:2"]);
  });

  it("does not guess about namespace imports or side-effect imports", () => {
    expect(exportsOf("export const b = 1;", 'import * as ns from "./m.js";')).toEqual([]);
    expect(exportsOf("export const b = 1;", 'import "./m.js";')).toEqual([]);
  });

  it("copes with circular re-exports", () => {
    const files = {
      "main.js": 'import { nope } from "./a.js";',
      "a.js": 'export * from "./b.js";',
      "b.js": 'export * from "./a.js";',
    };
    expect(problems(workspace(files, "main.js"))).toEqual(["missing-export@main.js:1"]);
  });
});
