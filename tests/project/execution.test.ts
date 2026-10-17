import { describe, expect, it } from "vitest";
import { EventKind } from "@/engine/core/protocol/events";
import { TRACER_GLOBAL } from "@/engine/languages/javascript/traceApi";
import { runProject } from "./runProject";

describe("running a project as native modules", () => {
  it("runs the example: main.js imports add from utils/math.js", async () => {
    const run = await runProject({
      "main.js":
        'import { add } from "./utils/math.js";\nconst result = add(10, 20);\nconsole.log(result);',
      "utils/math.js": "export function add(a, b) {\n  return a + b;\n}",
    });
    expect(run.outcome).toEqual({ kind: "ok" });
    expect(run.output).toEqual(["30"]);
  });

  it("numbers locations project-wide and tags each with its file", async () => {
    const run = await runProject({
      "main.js": 'import { add } from "./utils/math.js";\nconsole.log(add(1, 2));',
      "utils/math.js": "export function add(a, b) {\n  return a + b;\n}",
    });
    const { program } = run.build;
    expect(program.files.map((f) => f.path)).toEqual(["main.js", "utils/math.js"]);
    program.locs.forEach((loc) => expect(program.files[loc.file]).toBeDefined());
    const fileOfLine = (kind: number) =>
      run.events.flatMap((e) =>
        e.k === kind && "l" in e ? [program.files[program.locs[e.l]!.file]!.path] : [],
      );
    // The call into add is reported at a location inside utils/math.js …
    const callFiles = run.events.flatMap((e) =>
      e.k === EventKind.Call ? [program.files[program.locs[e.l]!.file]!.path] : [],
    );
    expect(callFiles).toContain("utils/math.js");
    // … and steps run in both files.
    expect(new Set(fileOfLine(EventKind.Line))).toEqual(new Set(["main.js", "utils/math.js"]));
  });

  it("gives every module a disjoint id range with dense tables", async () => {
    const run = await runProject({
      "main.js": 'import "./a.js";\nimport "./b.js";\nlet x = 1;\nx = 2;',
      "a.js": "let a = 1;\na = 2;",
      "b.js": "let b = 1;\nb = 2;",
    });
    const { program } = run.build;
    const filesByLoc = program.locs.map((l) => l.file);
    expect(filesByLoc).toEqual(filesByLoc.toSorted((a, b) => a - b));
    const bindingNames = program.bindings.map((b) => b.name);
    expect(bindingNames).toEqual(expect.arrayContaining(["x", "a", "b"]));
    expect(
      run.events.filter((e) => e.k === EventKind.Declare && e.b >= program.bindings.length),
    ).toEqual([]);
  });

  it("keeps ES live bindings", async () => {
    const run = await runProject({
      "main.js": 'import { n, inc } from "./c.js";\nconsole.log(n);\ninc();\nconsole.log(n);',
      "c.js": "export let n = 0;\nexport function inc() {\n  n++;\n}",
    });
    expect(run.output).toEqual(["0", "1"]);
  });

  it("supports default, namespace and re-exported bindings", async () => {
    const run = await runProject({
      "main.js":
        'import dflt, * as ns from "./m.js";\nimport { renamed } from "./barrel.js";\nconsole.log(dflt, ns.a, renamed);',
      "m.js": 'export const a = 1;\nexport default "d";',
      "barrel.js": 'export { a as renamed } from "./m.js";',
    });
    expect(run.output).toEqual(["d 1 1"]);
  });

  it("evaluates dependencies once, first, in import order", async () => {
    const run = await runProject({
      "main.js": 'import "./x.js";\nimport "./y.js";\nconsole.log("main");',
      "x.js": 'import "./z.js";\nconsole.log("x");',
      "y.js": 'import "./z.js";\nconsole.log("y");',
      "z.js": 'console.log("z");',
    });
    expect(run.output).toEqual(["z", "x", "y", "main"]);
  });

  it("follows ES semantics for circular imports", async () => {
    const run = await runProject({
      "main.js": 'import { fa } from "./a.js";\nconsole.log(fa());',
      "a.js":
        'import { fb } from "./b.js";\nconsole.log("a body");\nexport function fa() {\n  return "fa>" + fb();\n}',
      "b.js":
        'import { fa } from "./a.js";\nconsole.log("b body", typeof fa);\nexport function fb() {\n  return "fb";\n}',
    });
    expect(run.output).toEqual(["b body function", "a body", "fa>fb"]);
  });

  it("reports a cycle's temporal dead zone as the runtime error it is", async () => {
    const run = await runProject({
      "main.js": 'import "./a.js";',
      "a.js": 'import { b } from "./b.js";\nexport const a = b + 1;',
      "b.js": 'import { a } from "./a.js";\nexport const b = a + 1;',
    });
    expect(run.outcome).toMatchObject({ kind: "exception" });
    expect(run.outcome.kind === "exception" && run.outcome.message).toContain(
      "before initialization",
    );
  });

  it("strips TypeScript types in typed modules and resolves .js to .ts", async () => {
    const run = await runProject(
      {
        "main.ts":
          'import { double } from "./lib/double.js";\nconst n: number = double(21);\nconsole.log(n);',
        "lib/double.ts": "export const double = (x: number): number => x * 2;",
      },
      "main.ts",
    );
    expect(run.output).toEqual(["42"]);
  });

  it("locates a runtime exception in the imported module that threw", async () => {
    const run = await runProject({
      "main.js": 'import { boom } from "./bad.js";\nboom();',
      "bad.js": 'export function boom() {\n  throw new Error("kaboom");\n}',
    });
    expect(run.outcome.kind).toBe("exception");
    if (run.outcome.kind !== "exception" || run.outcome.loc === null) throw new Error("no loc");
    const loc = run.build.program.locs[run.outcome.loc]!;
    expect(run.build.program.files[loc.file]!.path).toBe("bad.js");
    expect(loc.line).toBe(2);
  });

  it("reports a missing named export from the engine's link step", async () => {
    const run = await runProject({
      "main.js": 'import { nope } from "./a.js";\nconsole.log(nope);',
      "a.js": "export const a = 1;",
    });
    expect(run.outcome).toMatchObject({ kind: "exception" });
    expect(run.outcome.kind === "exception" && run.outcome.message).toContain("nope");
  });

  it("leaves no tracer behind for later code", async () => {
    await runProject({ "main.js": "console.log(1);" });
    expect((globalThis as Record<string, unknown>)[TRACER_GLOBAL]).toBeUndefined();
  });
});
