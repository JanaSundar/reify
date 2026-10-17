import { describe, expect, it } from "vitest";
import { buildTree, tabLabel } from "@/features/workspace/fileTree";
import {
  initialWorkspace,
  workspaceReducer,
  type WorkspaceState,
} from "@/features/workspace/files";
import { planRun } from "@/features/workspace/runPlan";

const state = (active: string, entry: string | null = null): WorkspaceState =>
  workspaceReducer(
    { ...initialWorkspace(), entry },
    { type: "open", ref: { kind: "file", id: active } },
  );

describe("planRun", () => {
  it("runs the open JS file as a project entry, using the editor text", () => {
    const plan = planRun(state("demo-main"), "EDITED")!;
    expect(plan.project!.entry).toBe("demo/main.js");
    expect(plan.source).toBe("EDITED");
    expect(plan.project!.files.find((f) => f.path === "demo/main.js")!.source).toBe("EDITED");
    expect(plan.project!.files.map((f) => f.path)).toContain("demo/stats/math.js");
    expect(plan.keysByPath.get("demo/stats/math.js")).toBe("file:demo-math");
  });

  it("prefers the pinned entry over the open file, keeping the open file's newer text", () => {
    const plan = planRun(state("demo-math", "demo-main"), "NEW MATH")!;
    expect(plan.project!.entry).toBe("demo/main.js");
    expect(plan.entryKey).toBe("file:demo-main");
    const math = plan.project!.files.find((f) => f.path === "demo/stats/math.js")!;
    expect(math.source).toBe("NEW MATH");
  });

  it("runs examples and Python files alone", () => {
    expect(planRun(initialWorkspace(), "x")!.project).toBeUndefined();
    let s = workspaceReducer(initialWorkspace(), {
      type: "create",
      id: "p",
      name: "a.py",
      source: "print(1)",
    });
    s = workspaceReducer(s, { type: "open", ref: { kind: "file", id: "p" } });
    const plan = planRun(s, "print(2)")!;
    expect(plan).toMatchObject({ languageId: "python", source: "print(2)" });
    expect(plan.project).toBeUndefined();
  });

  it("has nothing to run with no open file", () => {
    expect(planRun({ ...initialWorkspace(), active: null, tabs: [] }, "")).toBeNull();
  });
});

describe("file tree", () => {
  it("nests folders first, sorted", () => {
    const tree = buildTree(initialWorkspace().files);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "folder:demo",
      "file:example.ts",
      "file:index.js",
      "file:utils.js",
    ]);
    const demo = tree[0]!;
    expect(demo.kind === "folder" && demo.children.map((n) => n.name)).toEqual([
      "stats",
      "main.js",
    ]);
  });

  it("labels clashing tab names with their folder", () => {
    const open = ["a/x.js", "b/x.js", "y.js"];
    expect(tabLabel("a/x.js", open)).toBe("x.js · a");
    expect(tabLabel("y.js", open)).toBe("y.js");
  });
});

describe("file tree: empty folders", () => {
  it("shows created folders even with no files, nested", () => {
    const tree = buildTree([], ["a/b", "c"]);
    expect(tree.map((n) => n.name)).toEqual(["a", "c"]);
    const a = tree[0]!;
    expect(a.kind === "folder" && a.children.map((n) => n.name)).toEqual(["b"]);
  });
});
