import { describe, expect, it } from "vitest";
import { compileProject } from "@/engine/core/project/compileProject";
import { KeyedCache } from "@/engine/core/project/KeyedCache";
import type { ModuleCompileResult } from "@/engine/core/project/types";
import { buildGraph } from "@/engine/core/project/graph";
import { hostFor, project, toyLanguage } from "./helpers";

const urlFor = (path: string) => `/__reify/1/${path}`;

const setup = (files: Record<string, string>) => {
  const language = toyLanguage();
  const graph = buildGraph(project(files), hostFor(language));
  return { language, graph };
};

const FILES = {
  "main.toy": "import ./a.toy\nimport ./b.toy\nlet m",
  "a.toy": "let a1\nlet a2\nplain",
  "b.toy": "let b1",
};

describe("compileProject", () => {
  it("assigns each module the ids after the modules before it", () => {
    const { language, graph } = setup(FILES);
    const result = compileProject(graph, urlFor);
    expect(result.ok).toBe(true);
    // main: 3 locs / 1 binding; a: 3 / 2; b: 1 / 1.
    expect(language.compiles).toEqual(["main.toy@0/0", "a.toy@3/1", "b.toy@6/3"]);
  });

  it("links dense tables whose locations name their file", () => {
    const { graph } = setup(FILES);
    const result = compileProject(graph, urlFor);
    if (!result.ok) throw new Error("build failed");
    const { program, entryUrl, modules } = result.build;
    expect(entryUrl).toBe("/__reify/1/main.toy");
    expect(modules.map((m) => m.url)).toEqual([
      "/__reify/1/main.toy",
      "/__reify/1/a.toy",
      "/__reify/1/b.toy",
    ]);
    expect(program.files).toEqual([
      { id: 0, path: "main.toy" },
      { id: 1, path: "a.toy" },
      { id: 2, path: "b.toy" },
    ]);
    expect(program.locs.map((l) => l.file)).toEqual([0, 0, 0, 1, 1, 1, 2]);
    expect(program.bindings).toHaveLength(4);
    expect(program.languageId).toBe("toy");
  });

  it("does not compile a graph that has errors, and returns its diagnostics", () => {
    const { language, graph } = setup({ "main.toy": "import ./missing.toy" });
    const result = compileProject(graph, urlFor);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "missing-module" }] });
    expect(language.compiles).toEqual([]);
  });

  it("reports every module's compile errors under its own path", () => {
    const { graph } = setup({
      "main.toy": "import ./a.toy\nimport ./b.toy",
      "a.toy": "compile-error",
      "b.toy": "compile-error",
    });
    const result = compileProject(graph, urlFor);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostics.map((d) => d.path)).toEqual(["a.toy", "b.toy"]);
  });
});

describe("compile cache", () => {
  it("recompiles nothing when nothing changed", () => {
    const { language, graph } = setup(FILES);
    const cache = new KeyedCache<ModuleCompileResult>();
    compileProject(graph, urlFor, cache);
    compileProject(graph, urlFor, cache);
    expect(language.compiles).toHaveLength(3);
  });

  it("recompiles an edited module and only the later modules whose slots moved", () => {
    const language = toyLanguage();
    const cache = new KeyedCache<ModuleCompileResult>();
    const host = hostFor(language);
    compileProject(buildGraph(project(FILES), host), urlFor, cache);
    language.compiles.length = 0;

    // Editing the last module moves nobody else.
    compileProject(
      buildGraph(project({ ...FILES, "b.toy": "let b1\nlet b2" }), host),
      urlFor,
      cache,
    );
    expect(language.compiles).toEqual(["b.toy@6/3"]);

    language.compiles.length = 0;
    // Growing the middle module shifts the one after it, but not the one before.
    const edited = { ...FILES, "a.toy": "let a1\nlet a2\nplain\nplain", "b.toy": "let b1\nlet b2" };
    compileProject(buildGraph(project(edited), host), urlFor, cache);
    expect(language.compiles).toEqual(["a.toy@3/1", "b.toy@7/3"]);
  });

  it("recompiles when an import's url changes", () => {
    const { language, graph } = setup(FILES);
    const cache = new KeyedCache<ModuleCompileResult>();
    compileProject(graph, urlFor, cache);
    language.compiles.length = 0;
    compileProject(graph, (path) => `/__reify/2/${path}`, cache);
    expect(language.compiles).toEqual(["main.toy@0/0"]);
  });

  it("drops entries of deleted files", () => {
    const { language, graph } = setup(FILES);
    const cache = new KeyedCache<ModuleCompileResult>();
    compileProject(graph, urlFor, cache);
    cache.retain(new Set(["main.toy"]));
    language.compiles.length = 0;
    compileProject(graph, urlFor, cache);
    expect(language.compiles).toEqual(["a.toy@3/1", "b.toy@6/3"]);
  });
});
