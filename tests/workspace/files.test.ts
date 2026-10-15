import { describe, expect, it } from "vitest";
import {
  docKey,
  initialWorkspace,
  resolveDoc,
  uniqueName,
  workspaceReducer,
  type WorkspaceState,
} from "@/features/workspace/files";

const start = (): WorkspaceState => initialWorkspace();

describe("workspace files", () => {
  it("opens an example by default and resolves its source", () => {
    const state = start();
    const doc = resolveDoc(state, state.active)!;
    expect(doc.name).toBe("array-map.js");
    expect(doc.languageId).toBe("javascript");
  });

  it("creates uniquely named files and opens them in a tab", () => {
    let state = workspaceReducer(start(), { type: "create", id: "a" });
    state = workspaceReducer(state, { type: "create", id: "b" });
    expect(state.files.map((f) => f.name)).toContain("untitled-2.js");
    expect(state.active).toEqual({ kind: "file", id: "b" });
    expect(state.tabs).toHaveLength(3);
  });

  it("keeps example edits in the session and file edits in the file", () => {
    let state = workspaceReducer(start(), { type: "edit", source: "let x = 1;" });
    expect(state.exampleEdits["array-map"]).toBe("let x = 1;");
    state = workspaceReducer(state, { type: "open", ref: { kind: "file", id: "index" } });
    state = workspaceReducer(state, { type: "edit", source: "let y = 2;" });
    expect(state.files.find((f) => f.id === "index")!.source).toBe("let y = 2;");
  });

  it("renames with the language extension and keeps names unique", () => {
    let state = workspaceReducer(start(), { type: "open", ref: { kind: "file", id: "index" } });
    state = workspaceReducer(state, { type: "language", languageId: "typescript" });
    expect(resolveDoc(state, state.active)!.name).toBe("index.ts");
    state = workspaceReducer(state, { type: "rename", id: "index", name: "utils.js" });
    expect(resolveDoc(state, state.active)!.name).toBe("utils-2.js");
  });

  it("deleting the active file falls back to another open document", () => {
    let state = workspaceReducer(start(), { type: "open", ref: { kind: "file", id: "utils" } });
    state = workspaceReducer(state, { type: "delete", id: "utils" });
    expect(state.files.some((f) => f.id === "utils")).toBe(false);
    expect(resolveDoc(state, state.active)).not.toBeNull();
    expect(state.tabs.every((tab) => resolveDoc(state, tab) !== null)).toBe(true);
  });

  it("toggles breakpoints per document, sorted", () => {
    let state = workspaceReducer(start(), { type: "toggleBreakpoint", line: 4 });
    state = workspaceReducer(state, { type: "toggleBreakpoint", line: 2 });
    expect(state.breakpoints[docKey(state.active)]).toEqual([2, 4]);
    state = workspaceReducer(state, { type: "toggleBreakpoint", line: 4 });
    expect(state.breakpoints[docKey(state.active)]).toEqual([2]);
  });

  it("uniqueName suffixes before the extension", () => {
    const files = [
      {
        id: "1",
        name: "a.js",
        source: "",
        suite: { entry: "", target: "return" as const, cases: [] },
      },
    ];
    expect(uniqueName(files, "a.js")).toBe("a-2.js");
    expect(uniqueName(files, "b.js")).toBe("b.js");
  });
});
