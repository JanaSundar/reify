import { beforeAll, describe, expect, it } from "vitest";
import { PythonService } from "@/engine/languages/python/service/PythonService";
import { PYODIDE_TIMEOUT_MS, testPyodide } from "./helpers";

let service: PythonService;
beforeAll(async () => {
  service = PythonService.create(await testPyodide());
}, PYODIDE_TIMEOUT_MS);

/** Completions with the cursor at the end of `source`. */
const labels = (source: string, explicit = false): string[] => {
  service.update(source);
  return service.complete(source.length, explicit)?.options.map((o) => o.label) ?? [];
};

describe("python service diagnostics", () => {
  it("reports syntax errors with a range, and nothing for valid code", () => {
    service.update("x = (1 +\n");
    const [d] = service.diagnostics();
    expect(d).toMatchObject({ severity: "error", code: "syntax" });
    service.update("x = 1\n");
    expect(service.diagnostics()).toEqual([]);
  });
});

describe("python service completions", () => {
  it("offers names in scope, then builtins and keywords, filtered by prefix", () => {
    const names = labels("def total(items):\n    count = 0\n    co");
    expect(names[0]).toBe("count");
    expect(names).toEqual(expect.arrayContaining(["complex", "continue"]));
    expect(names.every((n) => n.toLowerCase().includes("co"))).toBe(true);
  });

  it("sees parameters and module-level names, but not another function's locals", () => {
    const source = "limit = 3\ndef other():\n    hidden = 1\ndef f(width):\n    return ";
    const names = labels(source, true);
    expect(names).toEqual(expect.arrayContaining(["width", "limit", "f", "other"]));
    expect(names).not.toContain("hidden");
  });

  it("completes members of built-in types inferred from values", () => {
    expect(labels("words = 'a b'.split()\nwords.ap")).toContain("append");
    expect(labels("name = input()\nname.up")).toContain("upper");
    expect(labels("'abc'.sta")).toEqual(expect.arrayContaining(["startswith"]));
    expect(labels("d = {}\nd.ite")).toContain("items");
  });

  it("completes members of standard-library modules", () => {
    expect(labels("import math\nmath.sq")).toContain("sqrt");
  });

  it("completes members of user classes, including self and inherited ones", () => {
    const source = [
      "class Base:",
      "    def ping(self): pass",
      "class Stack(Base):",
      "    size = 0",
      "    def __init__(self):",
      "    ",
      "        self.items = []",
      "    def push(self, item):",
      "        self.",
    ].join("\n");
    expect(labels(source)).toEqual(expect.arrayContaining(["items", "push", "size", "ping"]));
    expect(labels("class Stack:\n    def push(self): pass\ns = Stack()\ns.pu")).toContain("push");
  });

  it("answers with nothing for unknown receivers and on bare whitespace", () => {
    expect(labels("mystery().x")).toEqual([]);
    expect(labels("x = 1\n")).toEqual([]);
  });

  it("falls back to builtins and keywords when the file cannot be parsed", () => {
    expect(labels("def (:\n    pri")).toContain("print");
  });

  it("counts positions in UTF-16 units", () => {
    const source = "emoji = '😀'\nemoji.up";
    service.update(source);
    const result = service.complete(source.length, false);
    expect(result?.from).toBe(source.length - 2);
  });
});

/** Hover info for the identifier ending the last occurrence of `needle`. */
const at = (source: string, needle: string) => {
  service.update(source);
  return service.hover(source.lastIndexOf(needle) + 1);
};

describe("python service hover", () => {
  it("describes user functions, classes and variables", () => {
    const source =
      "def area(w: int, h: int = 2) -> int:\n    '''Area of a box.'''\n    return w * h\nbox = [1]\narea(1)\nbox";
    expect(at(source, "area")).toMatchObject({
      text: "def area(w: int, h: int=2) -> int",
      documentation: "Area of a box.",
    });
    expect(at(source, "box")?.text).toBe("(variable) box: list");
    expect(at("class Stack(list): pass\nStack", "Stack")?.text).toBe("class Stack(list)");
  });

  it("describes built-ins and their members", () => {
    expect(at("len([1])", "len")?.text).toMatch(/^def len\(/);
    expect(at("'a'.upper()", "upper")?.text).toMatch(/^def str\.upper/);
  });

  it("is silent where there is nothing to say", () => {
    expect(at("x = 1  # note", "note")).toBeNull();
  });
});
