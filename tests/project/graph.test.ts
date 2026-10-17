import { describe, expect, it } from "vitest";
import { buildGraph, hasErrors } from "@/engine/core/project/graph";
import { dependentsOf, evaluationOrder, findCycles } from "@/engine/core/project/order";
import { cachedLanguage, ScanCache } from "@/engine/core/project/scanCache";
import { hostFor, project, toyLanguage } from "./helpers";

const graphOf = (files: Record<string, string>, entry?: string) => {
  const language = toyLanguage();
  return buildGraph(project(files, entry), hostFor(language));
};

const codes = (graph: ReturnType<typeof graphOf>) =>
  graph.diagnostics.map((d) => `${d.code}@${d.path}`);

describe("buildGraph", () => {
  it("discovers nested modules reachable from the entry only", () => {
    const graph = graphOf({
      "main.toy": "import ./utils/math.toy add",
      "utils/math.toy": "import ../lib/base.toy",
      "lib/base.toy": "",
      "unused.toy": "",
    });
    expect([...graph.modules.keys()]).toEqual(["main.toy", "utils/math.toy", "lib/base.toy"]);
    expect(graph.modules.get("main.toy")!.imports[0]).toMatchObject({
      target: "utils/math.toy",
      ref: { names: ["add"] },
    });
    expect(graph.diagnostics).toEqual([]);
  });

  it("normalizes the entry and file paths", () => {
    const graph = graphOf({ "./a//main.toy": "" }, "a/./main.toy");
    expect([...graph.modules.keys()]).toEqual(["a/main.toy"]);
    expect(graph.entry).toBe("a/main.toy");
  });

  it("reports an entry that is missing or invalid, with no modules", () => {
    expect(codes(graphOf({ "a.toy": "" }))).toEqual(["invalid-entry@main.toy"]);
    expect(codes(graphOf({ "a.toy": "" }, "../a.toy"))).toEqual(["invalid-entry@../a.toy"]);
    expect(graphOf({ "a.toy": "" }).modules.size).toBe(0);
  });

  it("reports missing modules at the import's range", () => {
    const graph = graphOf({ "main.toy": "\nimport ./gone.toy" });
    expect(graph.diagnostics).toHaveLength(1);
    expect(graph.diagnostics[0]).toMatchObject({
      code: "missing-module",
      path: "main.toy",
      range: { line: 2 },
    });
    expect(hasErrors(graph)).toBe(true);
  });

  it("reports unsupported specifiers, escapes, dynamic imports and syntax errors", () => {
    const graph = graphOf({
      "main.toy": "import lodash\nimport ../x.toy\ndynamic ./y.toy\nsyntax-error",
    });
    expect(graph.diagnostics.map((d) => d.code)).toEqual([
      "syntax",
      "unsupported-specifier",
      "path-escapes-root",
      "unsupported-dynamic-import",
    ]);
  });

  it("reports duplicate and invalid file paths", () => {
    const graph = graphOf({ "main.toy": "", "./main.toy": "", "/abs.toy": "" });
    expect(codes(graph)).toEqual(["duplicate-path@main.toy", "invalid-path@/abs.toy"]);
  });

  it("reports files with no language and imports across languages", () => {
    const a = toyLanguage("a");
    const b = toyLanguage("b");
    const host = {
      languageOf: (path: string) =>
        path.startsWith("b/") ? b : path.endsWith(".toy") ? a : undefined,
    };
    const files = {
      "main.toy": "import ./b/x.toy\nimport ./notes.txt",
      "b/x.toy": "",
      "notes.txt": "",
    };
    const graph = buildGraph(project(files), host);
    expect(codes(graph)).toEqual([
      "cross-language-import@main.toy",
      "unsupported-language@main.toy",
    ]);
    expect(graph.diagnostics[1]!.range).toMatchObject({ line: 2 });
  });

  it("rejects an entry that is not a runnable file", () => {
    const graph = graphOf({ "notes.txt": "" }, "notes.txt");
    expect(codes(graph)).toEqual(["unsupported-language@notes.txt"]);
  });

  it("treats a rename as a missing module until the import is updated", () => {
    const files = { "main.toy": "import ./a.toy", "a.toy": "" };
    expect(graphOf(files).diagnostics).toEqual([]);
    const renamed = { "main.toy": "import ./a.toy", "b.toy": "" };
    expect(codes(graphOf(renamed))).toEqual(["missing-module@main.toy"]);
  });
});

describe("evaluationOrder", () => {
  it("runs imports first, in source order, once each", () => {
    const graph = graphOf({
      "main.toy": "import ./x.toy\nimport ./y.toy",
      "x.toy": "import ./z.toy",
      "y.toy": "import ./z.toy",
      "z.toy": "",
    });
    expect(evaluationOrder(graph)).toEqual(["z.toy", "x.toy", "y.toy", "main.toy"]);
  });

  it("starts a cycle at its entry point: the dependency runs first", () => {
    const graph = graphOf({
      "main.toy": "import ./a.toy",
      "a.toy": "import ./b.toy",
      "b.toy": "import ./a.toy",
    });
    expect(evaluationOrder(graph)).toEqual(["b.toy", "a.toy", "main.toy"]);
  });
});

describe("findCycles", () => {
  it("finds mutual and self imports and ignores diamonds", () => {
    const graph = graphOf({
      "main.toy": "import ./a.toy\nimport ./c.toy\nimport ./d.toy",
      "a.toy": "import ./b.toy",
      "b.toy": "import ./a.toy",
      "c.toy": "import ./d.toy",
      "d.toy": "import ./d.toy",
    });
    const cycles = findCycles(graph).map((c) => [...c].toSorted());
    expect(cycles).toEqual(expect.arrayContaining([["a.toy", "b.toy"], ["d.toy"]]));
    expect(cycles).toHaveLength(2);
    expect(findCycles(graphOf({ "main.toy": "import ./a.toy", "a.toy": "" }))).toEqual([]);
  });
});

describe("dependentsOf", () => {
  const graph = graphOf({
    "main.toy": "import ./a.toy\nimport ./c.toy",
    "a.toy": "import ./b.toy",
    "b.toy": "",
    "c.toy": "",
  });

  it("returns the changed module and everything that imports it, transitively", () => {
    expect([...dependentsOf(graph, ["b.toy"])].toSorted()).toEqual(["a.toy", "b.toy", "main.toy"]);
    expect([...dependentsOf(graph, ["c.toy"])].toSorted()).toEqual(["c.toy", "main.toy"]);
  });
});

describe("ScanCache", () => {
  const files = { "main.toy": "import ./a.toy\nimport ./b.toy", "a.toy": "", "b.toy": "" };

  it("scans each file once while its source is unchanged", () => {
    const language = toyLanguage();
    const cache = new ScanCache();
    const host = hostFor(cachedLanguage(language, cache));
    buildGraph(project(files), host);
    buildGraph(project(files), host);
    expect(language.scans).toBe(3);
  });

  it("rescans only the file that changed", () => {
    const language = toyLanguage();
    const cache = new ScanCache();
    const host = hostFor(cachedLanguage(language, cache));
    buildGraph(project(files), host);
    const edited = buildGraph(project({ ...files, "a.toy": "import ./b.toy" }), host);
    expect(language.scans).toBe(4);
    expect(edited.modules.get("a.toy")!.imports).toHaveLength(1);
  });

  it("forgets files that were deleted", () => {
    const language = toyLanguage();
    const cache = new ScanCache();
    const host = hostFor(cachedLanguage(language, cache));
    buildGraph(project(files), host);
    cache.retain(new Set(["main.toy"]));
    buildGraph(project(files), host);
    expect(language.scans).toBe(5);
  });
});
