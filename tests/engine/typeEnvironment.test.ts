import ts from "typescript";
import { describe, expect, it } from "vitest";
import { TypeScriptService } from "@/engine/languages/javascript/service/TypeScriptService";
import { collectLibs } from "../../scripts/ts-libs.mjs";
import {
  createTypeEnvironment,
  TS_MAIN_PATHS,
} from "@/engine/languages/javascript/typecheck/environment";

const env = createTypeEnvironment(ts, collectLibs());
const service = (languageId: keyof typeof TS_MAIN_PATHS, source: string) => {
  const s = new TypeScriptService(ts, env, TS_MAIN_PATHS[languageId]);
  s.update(source);
  return s;
};

describe("TypeScript service", () => {
  it("accepts well-typed programs that use the console and the standard library", () => {
    const s = service(
      "typescript",
      "const xs: number[] = [1, 2]; console.log(xs.map((x) => x * 2), new Map());",
    );
    expect(s.diagnostics()).toEqual([]);
  });

  it("rejects a string where a number is expected, at the argument", () => {
    const [d] = service("typescript", "function f(n: number) { return n; }\nf('a');").diagnostics();
    expect(d).toMatchObject({
      severity: "error",
      code: "ts2345",
      range: { line: 2, column: 2, endLine: 2, endColumn: 5 },
    });
  });

  it("has no DOM globals", () => {
    expect(service("typescript", "document.title;").diagnostics()).toHaveLength(1);
  });

  it("rejects type annotations in JavaScript, without type-checking it", () => {
    expect(service("javascript", "const n = 1; n.toFixed(2); n.nope;").diagnostics()).toEqual([]);
    const [d] = service("javascript", "const n: number = 1;").diagnostics();
    expect(d).toMatchObject({ severity: "error", code: "ts8010" });
  });

  it("completes members after a dot, by prefix", () => {
    const source = "const xs = [1, 2];\nxs.ma";
    const result = service("typescript", source).complete(source.length, false);
    expect(result?.from).toBe(source.length - 2);
    expect(result?.options.map((o) => o.label)).toEqual(expect.arrayContaining(["map"]));
    expect(result?.options.every((o) => o.label.toLowerCase().includes("ma"))).toBe(true);
  });

  it("does not open completions on whitespace unless asked", () => {
    const source = "const x = 1;\n";
    expect(service("typescript", source).complete(source.length, false)).toBeNull();
    expect(service("typescript", source).complete(source.length, true)).not.toBeNull();
  });

  it("describes the symbol under the cursor", () => {
    const source = "const answer: number = 42;";
    const info = service("typescript", source).hover(source.indexOf("answer"));
    expect(info?.text).toContain("answer: number");
  });
});
