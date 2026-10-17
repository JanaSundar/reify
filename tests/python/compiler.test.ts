import { formatCost } from "@/engine/core/analysis/cost";
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
  it("lists the source file and stamps every location with it", () => {
    const { program } = ok(compiler.compile("x = 1\nprint(x)\n"));
    expect(program.files).toEqual([{ id: 0, path: "main.py" }]);
    for (const loc of program.locs) expect(program.files[loc.file]).toBeDefined();
  });

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

const py = (...lines: string[]) => lines.join("\n");

const staticOf = (source: string) => {
  const { complexity } = ok(compiler.compile(source)).program;
  return complexity ? formatCost(complexity.time) : "n/a";
};

describe("Python compiler: static complexity", () => {
  const FIB = py(
    "def fib(n):",
    "    return n if n < 2 else fib(n - 1) + fib(n - 2)",
    "",
    "fib(10)",
  );

  it.each([
    ["constant work", py("a = 1 + 2", "print(a)"), "O(1)"],
    [
      "a single loop with dict lookups",
      py("m = {}", "for i in range(10):", "    m[i] = m.get(i, 0) + 1"),
      "O(n)",
    ],
    [
      "nested loops",
      py("for i in range(5):", "    for j in range(5):", "        print(i, j)"),
      "O(n²)",
    ],
    ["a nested comprehension", "pairs = [(i, j) for i in range(5) for j in range(5)]", "O(n²)"],
    [
      "binary search",
      py(
        "def search(xs, t):",
        "    lo, hi = 0, len(xs) - 1",
        "    while lo <= hi:",
        "        mid = (lo + hi) // 2",
        "        if xs[mid] == t:",
        "            return mid",
        "        if xs[mid] < t:",
        "            lo = mid + 1",
        "        else:",
        "            hi = mid - 1",
        "    return -1",
        "",
        "search([1, 2, 3], 2)",
      ),
      "O(log n)",
    ],
    ["naive recursion", FIB, "O(2ⁿ)"],
    [
      "memoized recursion",
      py("from functools import lru_cache", "", "@lru_cache(None)", FIB),
      "O(n)",
    ],
    [
      "sorting then scanning",
      py(
        "def f(xs):",
        "    ys = sorted(xs, key=lambda x: -x)",
        "    for y in ys:",
        "        print(y)",
        "",
        "f([3, 1, 2])",
      ),
      "O(n log n)",
    ],
    [
      "loops over two inputs, one after the other",
      py("xs, ys = [1, 2], [3]", "for x in xs:", "    print(x)", "for y in ys:", "    print(y)"),
      "O(n + m)",
    ],
    [
      "loops over two inputs, one inside the other",
      py("xs, ys = [1, 2], [3]", "for x in xs:", "    for y in ys:", "        print(x, y)"),
      "O(n·m)",
    ],
    [
      "a grid by its dimensions",
      py(
        "def walk(rows, cols):",
        "    for r in range(rows):",
        "        for c in range(cols):",
        "            print(r, c)",
        "",
        "walk(3, 4)",
      ),
      "O(n·m)",
    ],
    [
      "a helper's loop measured by its argument",
      py(
        "def total(items):",
        "    return sum(items)",
        "",
        "def pairs(xs, ys):",
        "    for x in xs:",
        "        total(ys)",
        "",
        "pairs([1], [2])",
      ),
      "O(n·m)",
    ],
    [
      "merge sort",
      py(
        "def sort(xs):",
        "    if len(xs) < 2:",
        "        return xs",
        "    mid = len(xs) // 2",
        "    left, right = sort(xs[:mid]), sort(xs[mid:])",
        "    out = []",
        "    while left and right:",
        "        out.append((left if left[0] <= right[0] else right).pop())",
        "    return out + left + right",
        "",
        "sort([3, 1, 2])",
      ),
      "O(n log n)",
    ],
    ["pop(0) inside a loop", py("q = [1, 2, 3]", "while q:", "    q.pop(0)"), "O(n²)"],
    [
      "a helper called inside a loop",
      py(
        "def total(xs):",
        "    s = 0",
        "    for x in xs:",
        "        s += x",
        "    return s",
        "",
        "for i in range(5):",
        "    total([1, 2])",
      ),
      "O(n·m)",
    ],
    [
      "recursion through self",
      py(
        "class Tree:",
        "    def depth(self, n):",
        "        return 0 if n == 0 else 1 + self.depth(n - 1)",
        "",
        "Tree().depth(3)",
      ),
      "O(n)",
    ],
  ])("estimates %s", (_name, source, expected) => {
    expect(staticOf(source)).toBe(expected);
  });

  it("explains its estimate", () => {
    const { complexity } = ok(compiler.compile(FIB)).program;
    expect(complexity?.steps[0]?.reason).toContain("calls itself 2 times");
  });
});
