import { beforeAll, describe, expect, it } from "vitest";
import type { CompileResult } from "@/engine/core/protocol/messages";
import type { PythonCompiler } from "@/engine/languages/python/compiler/PythonCompiler";
import { compilerFor, PYODIDE_TIMEOUT_MS, runBoth } from "./helpers";
import { PYTHON_PROGRAMS } from "./programs";

let compiler: PythonCompiler;
beforeAll(async () => {
  compiler = await compilerFor();
}, PYODIDE_TIMEOUT_MS);

const ok = (result: CompileResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};

const errorsOf = (source: string) => {
  const result = compiler.compile(source);
  return result.ok ? [] : result.diagnostics.map((d) => d.code);
};

describe("Python compiler: behaviour is preserved", () => {
  for (const [name, source] of Object.entries(PYTHON_PROGRAMS)) {
    it(`${name}: instrumented and plain output match`, async () => {
      const { plain, instrumented } = await runBoth(source, ok(compiler.compile(source)));
      expect(plain.length).toBeGreaterThan(0);
      expect(instrumented).toBe(plain);
    });
  }
});

describe("Python compiler: tables", () => {
  it("records statements, conditions, loops, calls and returns at their source ranges", () => {
    const { program } = ok(
      compiler.compile(
        "def f(n):\n    if n < 2:\n        return n\n    return f(n - 1)\n\nfor i in range(2):\n    f(i)\n",
      ),
    );
    const roles = program.locs.map((l) => `${l.role}@${l.line}`);
    expect(roles).toEqual(
      expect.arrayContaining([
        "statement@1",
        "call@1",
        "statement@2",
        "condition@2",
        "return@3",
        "loop@6",
        "statement@7",
      ]),
    );
    const condition = program.locs.find((l) => l.role === "condition")!;
    expect(condition).toMatchObject({ line: 2, column: 4, endLine: 2, endColumn: 12 });
    expect(condition.reads).toEqual(["n"]);
    const loop = program.locs.find((l) => l.role === "loop")!;
    // `range` is a builtin, so it is not a variable read.
    expect(loop.reads).toEqual([]);
  });

  it("classifies bindings the way CPython scopes them", () => {
    const { program } = ok(
      compiler.compile(
        [
          "total = 0",
          "def add(x):",
          "    global total",
          "    step = x",
          "    total += step",
          "class Point:",
          "    origin = 0",
          "def outer():",
          "    n = 0",
          "    def inner():",
          "        nonlocal n",
          "        n += 1",
          "    inner()",
          "try:",
          "    pass",
          "except Exception as error:",
          "    pass",
        ].join("\n"),
      ),
    );
    const kinds = program.bindings.map((b) => `${b.name}:${b.kind}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "total:global",
        "x:param",
        "step:local",
        "add:function",
        "Point:class",
        "n:local",
        "inner:function",
        "error:global",
      ]),
    );
    // `global total` and `nonlocal n` reuse the outer binding; class attributes are not variables.
    expect(program.bindings.filter((b) => b.name === "total")).toHaveLength(1);
    expect(program.bindings.filter((b) => b.name === "n")).toHaveLength(1);
    expect(program.bindings.some((b) => b.name === "origin")).toBe(false);
  });

  it("reports columns in characters, not UTF-8 bytes", () => {
    const { program } = ok(compiler.compile('s = "é"; t = 1\nif t:\n    pass\n'));
    const second = program.locs.find((l) => l.line === 1 && l.column > 0)!;
    expect(second.column).toBe(9);
  });

  it("warns about constructs that run as a single step", () => {
    const { program } = ok(compiler.compile("xs = [x * 2 for x in range(3)]\nf = lambda v: v\n"));
    expect(program.warnings.map((w) => w.code).toSorted()).toEqual([
      "partial-comprehension",
      "partial-lambda",
    ]);
    expect(program.languageId).toBe("python");
  });
});

describe("Python compiler: diagnostics", () => {
  it("reports syntax errors with a range", () => {
    const result = compiler.compile("def f(:\n    pass\n");
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ severity: "error", code: "syntax", range: { line: 1, column: 6 } }],
    });
  });

  it("reports errors only a full compile finds", () => {
    expect(errorsOf("return 1")).toEqual(["syntax"]);
    expect(errorsOf("for x in y:\n    pass\nbreak")).toEqual(["syntax"]);
  });

  it.each([
    ["async def f():\n    pass", "unsupported-async"],
    ["def gen():\n    yield 1", "unsupported-generator"],
    ["import os", "unsupported-module"],
    ["from . import x", "unsupported-module"],
    ["from math import *", "unsupported-module"],
    ["eval('1')", "unsupported-eval"],
    ["name = input()", "unsupported-eval"],
    ["__reify_x = 1", "reserved-name"],
  ])("rejects %j", (source, code) => {
    expect(errorsOf(source)).toContain(code);
  });

  it("allows the supported standard library modules", () => {
    expect(
      errorsOf("import heapq, math\nfrom collections import deque\nimport collections.abc"),
    ).toEqual([]);
  });
});
