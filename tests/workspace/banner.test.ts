import { describe, expect, it } from "vitest";
import { bannerFor } from "@/features/workspace/RunBanner";
import { placeOf } from "@/engine/core/trace/describe";

const range = { line: 2, column: 7, endLine: 2, endColumn: 20 };

describe("bannerFor: project failures", () => {
  it("links each located diagnostic to its file and line", () => {
    const banner = bannerFor(
      {
        kind: "compile",
        diagnostics: [
          {
            severity: "error",
            code: "missing-module",
            message: "Cannot find x",
            range,
            path: "a/b.js",
          },
          { severity: "error", code: "syntax", message: "bad", range, path: undefined },
        ],
      },
      null,
      null,
      false,
    )!;
    expect(banner.details[0]).toEqual({
      path: "a/b.js",
      line: 2,
      column: 7,
      text: "a/b.js:2 — Cannot find x",
    });
    expect(banner.details[1]).toBe("Line 2: bad");
  });

  it("names the file a runtime error was thrown in, only for a multi-file run", () => {
    const loc = {
      file: 1,
      line: 3,
      column: 2,
      endLine: 3,
      endColumn: 9,
      role: "statement",
      reads: [],
    } as const;
    const program = (files: string[]) =>
      ({ files: files.map((path, id) => ({ id, path })), locs: [loc] }) as never;
    const outcome = { kind: "exception", message: "boom", loc: 0 } as const;
    const multi = bannerFor(null, outcome, program(["main.js", "lib/x.js"]), false)!;
    expect(multi.details).toEqual([
      { path: "lib/x.js", line: 3, column: 2, text: "Thrown in lib/x.js:3" },
    ]);
    const single = bannerFor(null, outcome, program(["main.js"]), false)!;
    expect(single.details).toEqual(["Thrown while running line 3."]);
  });
});

describe("placeOf", () => {
  it("adds the file only when the run has several", () => {
    const files = [{ path: "a.js" }, { path: "b/c.js" }];
    expect(placeOf({ files }, { file: 1, line: 4 })).toBe("b/c.js line 4");
    expect(placeOf({ files: [files[0]!] }, { file: 0, line: 4 })).toBe("line 4");
  });
});
