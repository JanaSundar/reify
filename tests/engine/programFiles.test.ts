import { describe, expect, it } from "vitest";
import { SINGLE_FILE_ID } from "@/engine/core/protocol/program";
import { JavaScriptCompiler } from "@/engine/languages/javascript/compiler/JavaScriptCompiler";

const compile = (typescript: boolean) => {
  const result = new JavaScriptCompiler(
    typescript ? "typescript" : "javascript",
    typescript,
  ).compile("const x = 1;\nfunction f() { return x; }\nf();");
  if (!result.ok) throw new Error("compile failed");
  return result.program;
};

describe("program file table", () => {
  it("lists the one source file of a single-file program", () => {
    expect(compile(false).files).toEqual([{ id: SINGLE_FILE_ID, path: "main.js" }]);
    expect(compile(true).files).toEqual([{ id: SINGLE_FILE_ID, path: "main.ts" }]);
  });

  it("stamps every location with a file that exists in the table", () => {
    const program = compile(false);
    expect(program.locs.length).toBeGreaterThan(0);
    for (const loc of program.locs) expect(program.files[loc.file]).toBeDefined();
  });
});
