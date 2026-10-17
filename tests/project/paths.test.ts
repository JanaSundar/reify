import { describe, expect, it } from "vitest";
import {
  dirname,
  isRelativeSpecifier,
  normalizePath,
  resolveRelative,
} from "@/engine/core/project/paths";
import { resolveRelativeFile } from "@/engine/core/project/resolve";

const pathOf = (result: ReturnType<typeof normalizePath>) =>
  result.ok ? result.path : result.code;

describe("normalizePath", () => {
  it("collapses ./, .., repeated and backslash separators", () => {
    expect(pathOf(normalizePath("./utils//math.js"))).toBe("utils/math.js");
    expect(pathOf(normalizePath("a/b/../c.js"))).toBe("a/c.js");
    expect(pathOf(normalizePath("utils\\math.js"))).toBe("utils/math.js");
  });

  it("rejects paths that leave the project root", () => {
    expect(pathOf(normalizePath("../secret.js"))).toBe("path-escapes-root");
    expect(pathOf(normalizePath("a/../../b.js"))).toBe("path-escapes-root");
  });

  it("rejects absolute, drive, scheme, empty and null-byte paths", () => {
    const bad = ["/etc/passwd", "C:\\x.js", "https://x.dev/a.js", "", ".", "a/..", "a\0b"];
    expect(bad.map((path) => pathOf(normalizePath(path)))).toEqual(bad.map(() => "invalid-path"));
  });
});

describe("relative specifiers", () => {
  it("resolves against the importing file's directory", () => {
    expect(dirname("a/b/c.js")).toBe("a/b");
    expect(dirname("c.js")).toBe("");
    expect(pathOf(resolveRelative("a/b/c.js", "../d.js"))).toBe("a/d.js");
    expect(pathOf(resolveRelative("main.js", "./utils/math.js"))).toBe("utils/math.js");
  });

  it("tells relative specifiers from bare and absolute ones", () => {
    expect(isRelativeSpecifier("./x")).toBe(true);
    expect(isRelativeSpecifier("../x")).toBe(true);
    expect(isRelativeSpecifier("lodash")).toBe(false);
    expect(isRelativeSpecifier("/x")).toBe(false);
  });
});

const exists = (path: string) => ["main.js", "utils/math.js", "lib/index.ts"].includes(path);
const alternatives = (path: string) => [path.replace(/\.js$/, ".ts")];

describe("resolveRelativeFile", () => {
  it("finds an exact file", () => {
    expect(resolveRelativeFile("./utils/math.js", "main.js", exists)).toEqual({
      ok: true,
      path: "utils/math.js",
    });
  });

  it("tries the language's alternatives when the exact file is absent", () => {
    expect(resolveRelativeFile("./lib/index.js", "main.js", exists, alternatives)).toEqual({
      ok: true,
      path: "lib/index.ts",
    });
  });

  it("reports missing modules with the file they were imported from", () => {
    const result = resolveRelativeFile("./nope.js", "main.js", exists);
    expect(result).toMatchObject({ ok: false, code: "missing-module" });
    expect(!result.ok && result.message).toContain("main.js");
  });

  it("refuses bare specifiers and paths that escape the project", () => {
    expect(resolveRelativeFile("lodash", "main.js", exists)).toMatchObject({
      code: "unsupported-specifier",
    });
    expect(resolveRelativeFile("../../x.js", "a/main.js", exists)).toMatchObject({
      code: "path-escapes-root",
    });
  });
});
