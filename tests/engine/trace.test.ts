import { describe, expect, it } from "vitest";
import { EventKind } from "@/engine/core/protocol/events";
import type { HeapObject } from "@/engine/core/protocol/values";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";
import type { StepView } from "@/engine/core/trace/stepView";
import { CORPUS } from "../corpus/programs";
import { storeFor, trace } from "../helpers";

const allViews = (source: string): StepView[] => {
  const store = storeFor(trace(source));
  const views: StepView[] = [];
  for (let i = 0; i < store.stepCount; i++) {
    store.seek(i);
    views.push(store.getSnapshot().view!);
  }
  return views;
};

const variable = (view: StepView, name: string) =>
  view.frames.flatMap((f) => f.variables).findLast((v) => v.name === name);

const heapOf = (view: StepView, name: string): HeapObject | undefined => {
  const value = variable(view, name)?.value;
  return value?.kind === "ref" ? view.heap.get(value.id) : undefined;
};

const lastView = (source: string): StepView => allViews(source).at(-1)!;

const compile = (source: string) => new JavaScriptCompiler("javascript", false).compile(source);
const diagnosticsOf = (source: string) => {
  const result = compile(source);
  return result.ok ? [] : result.diagnostics;
};

describe("compiler diagnostics", () => {
  it("reports syntax errors with a location", () => {
    expect(compile("let x = ;").ok).toBe(false);
    expect(diagnosticsOf("let x = ;")[0]).toMatchObject({
      code: "syntax",
      message: "Unexpected token",
      range: { line: 1 },
    });
  });

  it.each([
    ["async function f() {}", "unsupported-async"],
    ["function* g() {}", "unsupported-generator"],
    ["eval('1')", "unsupported-eval"],
    ["const __lc$t = 1", "reserved-name"],
  ])("rejects %s", (source, code) => {
    expect(compile(source).ok).toBe(false);
    expect(diagnosticsOf(source).map((d) => d.code)).toContain(code);
  });

  it("accepts an empty program", () => {
    const run = trace("");
    expect(run.outcome).toEqual({ kind: "ok" });
    expect(run.events).toHaveLength(0);
  });
});

describe("source mapping", () => {
  it("highlights original lines, including multi-line statements", () => {
    const views = allViews("let a = 1;\nlet b =\n  a + 1;\nif (b > 1) {\n  a = b;\n}");
    const lines = views.filter((v) => v.kind === "line").map((v) => v.loc?.line);
    expect(lines).toEqual([1, 2, 4, 5]);
    const multi = views.find((v) => v.loc?.line === 2)!;
    expect(multi.loc).toMatchObject({ line: 2, endLine: 3 });
  });

  it("maps TypeScript sources to original lines", () => {
    const run = trace("const n: number = 1;\ntype T = string;\nconst s: T = 'x';", {
      typescript: true,
    });
    const store = storeFor(run);
    store.seek(1);
    expect(store.getSnapshot().view?.loc?.line).toBe(3);
  });

  it("records the statement's variable reads", () => {
    const views = allViews("let i = 0, n = 3;\nwhile (i < n) i++;");
    const whileStep = views.find((v) => v.loc?.line === 2 && v.loc.role === "loop")!;
    expect(whileStep.loc?.reads).toEqual(["i", "n"]);
  });
});

describe("runtime state reconstruction", () => {
  it("tracks recursion with one frame per active call", () => {
    const views = allViews(CORPUS.fibonacci!);
    const maxDepth = Math.max(...views.map((v) => v.frames.length));
    expect(maxDepth).toBe(11); // global + fib(10)..fib(1)
    expect(views.at(-1)!.frames).toHaveLength(1);
    const deepest = views.find((v) => v.frames.length === 11)!;
    expect(variable(deepest, "n")?.value).toMatchObject({ text: "1" });
  });

  it("reconstructs array contents after writes and bulk mutations", () => {
    const view = lastView(CORPUS.arrayMutations!);
    const a = heapOf(view, "a");
    const items = a?.kind === "list" ? a.items : [];
    expect(items.map((i) => (i.kind === "primitive" ? i.text : "ref"))).toEqual([
      "12",
      "8",
      "100",
      "1",
    ]);
  });

  it("preserves aliasing through shared heap ids", () => {
    const view = lastView(CORPUS.aliasing!);
    const a = variable(view, "a")?.value;
    const b = variable(view, "b")?.value;
    expect(a).toEqual(b);
    const o = heapOf(view, "o");
    expect(o?.kind === "record" && o.fields[0]?.[1]).toEqual(a);
  });

  it("handles cyclic object graphs", () => {
    const view = lastView(CORPUS.cyclicGraph!);
    const a = variable(view, "a")?.value;
    const object = heapOf(view, "a");
    expect(object?.kind === "record" && object.fields.find(([k]) => k === "self")?.[1]).toEqual(a);
  });

  it("separates shadowed variables and drops block bindings", () => {
    const views = allViews(CORPUS.shadowing!);
    const inner = views.find(
      (v) => v.frames[0]!.variables.filter((x) => x.name === "x").length === 2,
    );
    expect(inner).toBeDefined();
    const values = inner!.frames[0]!.variables.filter((x) => x.name === "x").map((x) => x.value);
    expect(values).toEqual([
      expect.objectContaining({ text: "1" }),
      expect.objectContaining({ text: "2" }),
    ]);
    expect(views.at(-1)!.frames[0]!.variables.filter((x) => x.name === "x")).toHaveLength(1);
  });

  it("records branch decisions and loop iterations", () => {
    const run = trace("let n = 0;\nfor (let i = 0; i < 3; i++) { if (i % 2) n++; }");
    const branches = run.events
      .filter((e) => e.k === EventKind.Branch)
      .map((e) => e.k === EventKind.Branch && e.taken);
    expect(branches).toEqual([true, false, true, true, true, false, false]);
  });

  it("keeps frames balanced when exceptions unwind", () => {
    const views = allViews(CORPUS.exceptionsFinally!);
    expect(views.at(-1)!.frames).toHaveLength(1);
    expect(views.some((v) => v.facts.some((f) => f.kind === "throw"))).toBe(true);
    expect(
      views.some((v) => v.kind === "return" && v.facts.some((f) => f.text.includes("exception"))),
    ).toBe(true);
  });

  it("tracks closure variables after their frame returned", () => {
    const view = lastView(CORPUS.closures!);
    expect(view.closures.find((c) => c.name === "count")?.value).toMatchObject({ text: "3" });
  });

  it("marks changed variables with their previous value", () => {
    const views = allViews("let x = 1;\nx = 5;");
    const step = views.find((v) => variable(v, "x")?.previous)!;
    expect(variable(step, "x")).toMatchObject({
      changed: true,
      previous: { text: "1" },
      value: { text: "5" },
    });
  });

  it("reports uncaught exceptions with the failing location", () => {
    const run = trace(CORPUS.uncaught!);
    expect(run.outcome).toMatchObject({
      kind: "exception",
      message: "TypeError: Cannot read properties of undefined (reading 'z')",
    });
    const loc = run.outcome.kind === "exception" ? run.outcome.loc : null;
    expect(loc === null ? null : run.program.locs[loc]?.line).toBe(2);
  });
});

describe("resource limits", () => {
  it("stops infinite loops at the step budget", () => {
    const run = trace("let i = 0;\nwhile (true) { i++; }", { limits: { maxSteps: 1_000 } });
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "steps" });
  });

  it("cannot be swallowed by user catch blocks", () => {
    const run = trace("while (true) { try { for(;;){} } catch (e) {} }", {
      limits: { maxSteps: 500 },
    });
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "steps" });
  });

  it("stops runaway recursion at the call-depth budget", () => {
    const run = trace("function f(n) { return f(n + 1); }\nf(0);", {
      limits: { maxCallDepth: 200 },
    });
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "call-depth" });
  });

  it("truncates traces at the event budget", () => {
    const run = trace("const a = [];\nfor (let i = 0; i < 1e6; i++) a.push(i);", {
      limits: { maxEvents: 2_000 },
    });
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "events" });
    expect(run.events.length).toBeLessThanOrEqual(2_000);
    const store = storeFor(run);
    expect(store.getSnapshot().truncated).toBe(true);
  });

  it("caps captured collection sizes", () => {
    const run = trace("const big = new Array(5000).fill(1);", {
      limits: { maxCollectionItems: 100 },
    });
    const heap = run.events.find((e) => e.k === EventKind.Heap);
    expect(heap?.k === EventKind.Heap && heap.o.kind === "list" && heap.o.items.length).toBe(100);
    expect(heap?.k === EventKind.Heap && heap.o.omitted).toBe(4900);
  });
});
