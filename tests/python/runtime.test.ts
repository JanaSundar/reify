import { beforeAll, describe, expect, it } from "vitest";
import { EventKind } from "@/engine/core/protocol/events";
import type { HeapObject } from "@/engine/core/protocol/values";
import type { StepView } from "@/engine/core/trace/stepView";
import type { PythonCompiler } from "@/engine/languages/python/compiler/PythonCompiler";
import {
  compilerFor,
  PYODIDE_TIMEOUT_MS,
  PYTHON_TEST_LIMITS,
  runBoth,
  runtimeFor,
  tracePython,
  viewsOf,
} from "./helpers";
import { detectFunctionNames, traceSourceFor } from "@/features/tests/suite";
import { PYTHON_PROGRAMS } from "./programs";

let compiler: PythonCompiler;
beforeAll(async () => {
  compiler = await compilerFor();
  await runtimeFor();
}, PYODIDE_TIMEOUT_MS);

const variable = (view: StepView, name: string) =>
  view.frames.flatMap((f) => f.variables).findLast((v) => v.name === name);

const heapOf = (view: StepView, name: string): HeapObject | undefined => {
  const value = variable(view, name)?.value;
  return value?.kind === "ref" ? view.heap.get(value.id) : undefined;
};

const compileOk = (source: string) => {
  const result = compiler.compile(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};

/** Programs that finish normally; "uncaught exception" is checked on its own below. */
const COMPLETING = Object.entries(PYTHON_PROGRAMS).filter(
  ([name]) => name !== "uncaught exception",
);

describe("Python runtime: traced output matches the plain program", () => {
  for (const [name, source] of COMPLETING) {
    it(`${name}`, async () => {
      const { plain } = await runBoth(source, compileOk(source));
      const run = await tracePython(compiler, source);
      expect(run.outcome).toEqual({ kind: "ok" });
      expect(run.output.map((line) => `${line}\n`).join("")).toBe(plain);
      // Every trace replays through the real store.
      expect(viewsOf(run).length).toBeGreaterThan(0);
    });
  }

  it("uncaught exception: output up to the error, then the error", async () => {
    const source = PYTHON_PROGRAMS["uncaught exception"]!;
    const { plain } = await runBoth(source, compileOk(source));
    const run = await tracePython(compiler, source);
    expect(run.outcome).toMatchObject({
      kind: "exception",
      message: "ZeroDivisionError: division by zero",
    });
    expect(plain).toBe(`${run.output.join("\n")}\nraised ZeroDivisionError division by zero\n`);
  });
});

describe("Python runtime: what the trace shows", () => {
  it("declares, then assigns, variables and lists step facts", async () => {
    const run = await tracePython(compiler, "x = 1\nx = x + 1\nnames = ['a']\nnames.append('b')\n");
    const kinds = run.events.filter((e) => e.k === EventKind.Declare || e.k === EventKind.Assign);
    expect(kinds.map((e) => e.k)).toEqual([EventKind.Declare, EventKind.Assign, EventKind.Declare]);
    const last = viewsOf(run).at(-1)!;
    expect(variable(last, "x")?.value).toMatchObject({ kind: "primitive", text: "2" });
    expect(heapOf(last, "names")).toMatchObject({
      kind: "list",
      typeName: "list",
      items: [{ text: "'a'" }, { text: "'b'" }],
    });
  });

  it("records calls, parameters, returns and recursion depth", async () => {
    const run = await tracePython(
      compiler,
      "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\nresult = fact(4)\n",
    );
    const calls = run.events.filter((e) => e.k === EventKind.Call);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ name: "fact", params: [[expect.any(Number), { text: "4" }]] });
    const returns = run.events.filter((e) => e.k === EventKind.Return);
    expect(returns.at(-1)).toMatchObject({ value: { text: "24" }, threw: false });
    const views = viewsOf(run);
    expect(Math.max(...views.map((v) => v.frames.length))).toBe(5);
    expect(variable(views.at(-1)!, "result")?.value).toMatchObject({ text: "24" });
  });

  it("captures instances as nodes the viz can follow, without running user code", async () => {
    const run = await tracePython(
      compiler,
      [
        "class ListNode:",
        "    def __init__(self, val, next=None):",
        "        self.val = val",
        "        self.next = next",
        "    def __repr__(self):",
        "        raise RuntimeError('repr must not run')",
        "    @property",
        "    def double(self):",
        "        raise RuntimeError('property must not run')",
        "head = ListNode(1, ListNode(2))",
        "head.next.val = 20",
      ].join("\n"),
    );
    expect(run.outcome).toEqual({ kind: "ok" });
    const last = viewsOf(run).at(-1)!;
    const head = heapOf(last, "head")!;
    expect(head).toMatchObject({ kind: "instance", typeName: "ListNode" });
    if (head.kind !== "instance") return;
    expect(head.fields.map(([name]) => name)).toEqual(["val", "next"]);
    const next = head.fields[1]![1];
    const second = next.kind === "ref" ? last.heap.get(next.id) : undefined;
    expect(second).toMatchObject({
      fields: [
        ["val", { text: "20" }],
        ["next", { text: "None" }],
      ],
    });
    expect(run.events.some((e) => e.k === EventKind.Write && e.key === "val")).toBe(true);
  });

  it("encodes dicts, sets, tuples and deques as their heap kinds", async () => {
    const run = await tracePython(
      compiler,
      "from collections import deque\nd = {'a': 1}\ns = {3}\nt = (1, 2)\nq = deque([1])\nq.append(2)\n",
    );
    const last = viewsOf(run).at(-1)!;
    expect(heapOf(last, "d")).toMatchObject({ kind: "map", typeName: "dict" });
    expect(heapOf(last, "s")).toMatchObject({ kind: "set", typeName: "set" });
    expect(heapOf(last, "t")).toMatchObject({ kind: "list", typeName: "tuple" });
    expect(heapOf(last, "q")).toMatchObject({ kind: "list", typeName: "deque", items: [{}, {}] });
  });

  it("reports branches with the truth value, calling __bool__ once", async () => {
    const run = await tracePython(
      compiler,
      [
        "calls = []",
        "class Flag:",
        "    def __bool__(self):",
        "        calls.append(1)",
        "        return True",
        "if Flag():",
        "    print(len(calls))",
      ].join("\n"),
    );
    expect(run.output).toEqual(["1"]);
    expect(run.events.find((e) => e.k === EventKind.Branch)).toMatchObject({ taken: true });
  });

  it("reports an uncaught exception with its location and a Throw event", async () => {
    const run = await tracePython(compiler, "x = 1\ny = x / 0\n");
    expect(run.outcome).toMatchObject({
      kind: "exception",
      message: "ZeroDivisionError: division by zero",
    });
    expect(run.outcome.kind === "exception" && run.outcome.loc).not.toBeNull();
    expect(run.events.some((e) => e.k === EventKind.Throw)).toBe(true);
  });
});

describe("Python runtime: budgets", () => {
  it("stops infinite loops at the step budget, even through except clauses", async () => {
    const run = await tracePython(
      compiler,
      "while True:\n    try:\n        pass\n    except BaseException:\n        pass\n",
      { maxSteps: 500 },
    );
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "steps" });
    expect(run.outcome.kind === "limit" && run.outcome.message).toContain("500 steps");
    expect(run.steps).toBeGreaterThan(500);
  });

  it("stops runaway recursion as a call-depth limit", async () => {
    const run = await tracePython(compiler, "def f(n):\n    return f(n + 1)\n\nf(0)\n", {
      maxCallDepth: 50,
    });
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "call-depth" });
  });

  it("truncates the trace at the event budget", async () => {
    const run = await tracePython(compiler, "i = 0\nwhile True:\n    i += 1\n", { maxEvents: 300 });
    expect(run.outcome).toMatchObject({ kind: "limit", limit: "events" });
    expect(run.events.length).toBeLessThanOrEqual(300);
  });
});

const suite = (entry: string, target: "return" | "first-argument" = "return") => ({
  entry,
  target,
  cases: [],
});

describe("Python runtime: test cases", () => {
  it("passes, fails and measures the input size", async () => {
    const runtime = await runtimeFor();
    const program = compileOk(PYTHON_PROGRAMS["two sum"]!);
    const pass = runtime.runTest(
      program.code,
      suite("two_sum"),
      { id: "a", args: "[2, 7, 11, 15], 9", expected: "[0, 1]" },
      PYTHON_TEST_LIMITS,
    );
    expect(pass).toMatchObject({ caseId: "a", status: "pass", actual: "[0, 1]", inputSize: 4 });
    expect(pass.steps).toBeGreaterThan(0);
    const fail = runtime.runTest(
      program.code,
      suite("two_sum"),
      { id: "b", args: "[1, 2], 3", expected: "(1, 0)" },
      PYTHON_TEST_LIMITS,
    );
    expect(fail).toMatchObject({ status: "fail", actual: "[0, 1]", expected: "(1, 0)" });
  });

  it("compares instances by their fields and supports in-place targets", async () => {
    const runtime = await runtimeFor();
    const program = compileOk(
      "class Node:\n    def __init__(self, v):\n        self.v = v\n\ndef make(v):\n    return Node(v)\n\ndef clear(xs):\n    xs.clear()\n",
    );
    expect(
      runtime.runTest(
        program.code,
        suite("make"),
        { id: "n", args: "3", expected: "Node(3)" },
        PYTHON_TEST_LIMITS,
      ),
    ).toMatchObject({ status: "pass", actual: "Node(v=3)" });
    expect(
      runtime.runTest(
        program.code,
        suite("clear", "first-argument"),
        { id: "c", args: "[1, 2]", expected: "[]" },
        PYTHON_TEST_LIMITS,
      ),
    ).toMatchObject({ status: "pass", actual: "[]" });
  });

  it("explains missing functions, bad cases and limits", async () => {
    const runtime = await runtimeFor();
    const program = compileOk("def loop():\n    while True:\n        pass\n");
    const run = (entry: string, args: string, expected = "1") =>
      runtime.runTest(
        program.code,
        suite(entry),
        { id: "x", args, expected },
        {
          ...PYTHON_TEST_LIMITS,
          maxSteps: 100,
        },
      );
    expect(run("missing", "").message).toContain("No function named");
    expect(run("loop", "(").message).toContain("not valid Python");
    expect(run("loop", "")).toMatchObject({
      status: "limit",
      message: expect.stringContaining("100 steps"),
    });
  });
});

describe("Python runtime: lockdown", () => {
  it("blocks Pyodide's JavaScript bridge", async () => {
    const run = await tracePython(
      compiler,
      "import math\ntry:\n    __builtins__['__import__']('js')\n    print('reached js')\nexcept ImportError as error:\n    print('blocked')\n",
    );
    expect(run.output).toEqual(["blocked"]);
  });
});

describe("Python test-case helpers", () => {
  it("detects top-level functions, not methods", () => {
    const source =
      "def a(x):\n    def inner(): pass\nclass K:\n    def method(self): pass\ndef b():\n    pass\n";
    expect(detectFunctionNames(source, "python")).toEqual(["a", "b"]);
  });

  it("traces a single case by appending a print call", async () => {
    const testCase = { id: "a", args: "[2, 7, 11, 15], 9", expected: "[0, 1]" };
    const source = traceSourceFor(
      PYTHON_PROGRAMS["two sum"]!,
      suite("two_sum"),
      testCase,
      "python",
    );
    const run = await tracePython(compiler, source);
    expect(run.output.at(-1)).toBe("[0, 1]");
  });

  it("traces an in-place case by printing the first argument", async () => {
    const source = traceSourceFor(
      "def clear(xs):\n    xs.clear()\n",
      suite("clear", "first-argument"),
      { id: "c", args: "[1, 2]", expected: "[]" },
      "python",
    );
    const run = await tracePython(compiler, source);
    expect(run.output).toEqual(["[]"]);
  });
});
