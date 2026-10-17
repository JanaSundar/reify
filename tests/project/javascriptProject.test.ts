import { describe, expect, it } from "vitest";
import { buildGraph } from "@/engine/core/project/graph";
import { evaluationOrder, findCycles } from "@/engine/core/project/order";
import { projectHost } from "@/engine/languages/projectHost";
import { scanImports } from "@/engine/languages/javascript/project/scanImports";

const scan = (source: string, path = "main.js") => scanImports({ path, source });
const refs = (source: string, path?: string) =>
  scan(source, path).imports.map((i) => `${i.kind}:${i.specifier}[${i.names.join(",")}]`);

describe("scanImports", () => {
  it("reads named, default and namespace imports", () => {
    expect(
      refs(
        [
          'import { add, sub as minus } from "./math.js";',
          'import def from "./d.js";',
          'import * as ns from "./n.js";',
          'import def2, { x } from "./mixed.js";',
        ].join("\n"),
      ),
    ).toEqual([
      "static:./math.js[add,sub]",
      "static:./d.js[default]",
      "static:./n.js[*]",
      "static:./mixed.js[default,x]",
    ]);
  });

  it("reads side-effect imports as imports of no names", () => {
    expect(refs('import "./setup.js";')).toEqual(["static:./setup.js[]"]);
  });

  it("reads re-exports", () => {
    expect(
      refs(
        [
          'export { a, b as c } from "./a.js";',
          'export * from "./all.js";',
          'export * as ns from "./ns.js";',
          'export { default } from "./d.js";',
          'export { default as thing } from "./d2.js";',
        ].join("\n"),
      ),
    ).toEqual([
      "static:./a.js[a,b]",
      "static:./all.js[*]",
      "static:./ns.js[*]",
      "static:./d.js[default]",
      "static:./d2.js[default]",
    ]);
  });

  it("ignores exports without a source and string-named exports resolve by name", () => {
    expect(refs("export const a = 1; export function f() {}; export default 3;")).toEqual([]);
    expect(refs('import { "a-b" as ab } from "./s.js";')).toEqual(["static:./s.js[a-b]"]);
  });

  it("reports dynamic imports, anywhere in the file, as dynamic", () => {
    expect(refs('function f() { return import("./lazy.js"); }\nimport(name);')).toEqual([
      "dynamic:./lazy.js[]",
      "dynamic:(computed)[]",
    ]);
  });

  it("locates each import at its specifier", () => {
    const { imports } = scan('\nimport { a } from "./a.js";');
    expect(imports[0]!.range).toMatchObject({ line: 2, column: 18 });
  });

  it("reports syntax errors with a location and no imports", () => {
    const result = scan("import { from './x.js';\nconst = ;");
    expect(result.imports).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", code: "syntax" });
    expect(result.diagnostics[0]!.range).not.toBeNull();
  });

  it("parses files as modules (strict, top-level await allowed)", () => {
    expect(scan("await Promise.resolve(); export {};").diagnostics).toEqual([]);
  });

  it("strips TypeScript types: type-only imports and exports are not dependencies", () => {
    const source = [
      'import type { T } from "./types.js";',
      'import { type U, v } from "./values.js";',
      'import { type W } from "./only-types.js";',
      'export type { X } from "./x-types.js";',
      "const n: number = 1;",
    ].join("\n");
    expect(refs(source, "main.ts")).toEqual(["static:./values.js[v]", "static:./only-types.js[]"]);
  });
});

const build = (files: Record<string, string>, entry = "main.js") =>
  buildGraph(
    { files: Object.entries(files).map(([path, source]) => ({ path, source })), entry },
    projectHost,
  );

describe("javascriptProject graphs", () => {
  it("resolves the example project: main.js imports utils/math.js", () => {
    const graph = build({
      "main.js": 'import { add } from "./utils/math.js";\nconsole.log(add(10, 20));',
      "utils/math.js": "export function add(a, b) { return a + b; }",
    });
    expect(graph.diagnostics).toEqual([]);
    expect(evaluationOrder(graph)).toEqual(["utils/math.js", "main.js"]);
  });

  it("resolves a .js specifier to a .ts file for TypeScript sources", () => {
    const graph = build(
      {
        "main.ts": 'import { n } from "./lib/count.js"; console.log(n);',
        "lib/count.ts": "export const n: number = 1;",
      },
      "main.ts",
    );
    expect(graph.diagnostics).toEqual([]);
    expect([...graph.modules.keys()]).toEqual(["main.ts", "lib/count.ts"]);
  });

  it("handles nested re-exports and circular imports", () => {
    const graph = build({
      "main.js": 'import { a } from "./a.js";',
      "a.js": 'export { b } from "./b.js"; export const a = 1;',
      "b.js": 'import { a } from "./a.js"; export const b = a;',
    });
    expect(graph.diagnostics).toEqual([]);
    expect(findCycles(graph).map((c) => c.toSorted())).toEqual([["a.js", "b.js"]]);
    expect(evaluationOrder(graph)).toEqual(["b.js", "a.js", "main.js"]);
  });

  it("reports missing modules, bare specifiers, escapes and dynamic imports with locations", () => {
    const graph = build({
      "main.js": [
        'import "./gone.js";',
        'import "lodash";',
        'import "../outside.js";',
        'import("./lazy.js");',
      ].join("\n"),
    });
    expect(graph.diagnostics.map((d) => `${d.code}@${d.range?.line}`)).toEqual([
      "missing-module@1",
      "unsupported-specifier@2",
      "path-escapes-root@3",
      "unsupported-dynamic-import@4",
    ]);
  });

  it("surfaces syntax errors in imported modules under that module's path", () => {
    const graph = build({
      "main.js": 'import "./bad.js";',
      "bad.js": "export const = ;",
    });
    expect(graph.diagnostics).toMatchObject([{ code: "syntax", path: "bad.js" }]);
  });
});
