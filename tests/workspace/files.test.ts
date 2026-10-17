import { afterEach, describe, expect, it, vi } from "vitest";
import { languageById } from "@/engine/languages/catalog";
import {
  canSwitchLanguage,
  docKey,
  initialWorkspace,
  MAX_FILES,
  newFileSource,
  resolveDoc,
  saveWorkspace,
  uniqueName,
  workspaceReducer,
  type WorkspaceState,
} from "@/features/workspace/files";

const start = (): WorkspaceState => initialWorkspace();
const file = (id: string) => ({ kind: "file", id }) as const;
const ids = (state: WorkspaceState) => state.tabs.map((tab) => tab.id);

/** Tabs: array-map, index, utils, example-ts (in that order); `active` is the open one. */
const withTabs = (active: string): WorkspaceState => {
  let state = start();
  for (const id of ["index", "utils", "example-ts"]) {
    state = workspaceReducer(state, { type: "open", ref: file(id) });
  }
  return workspaceReducer(state, { type: "open", ref: file(active) });
};

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
    let state = workspaceReducer(start(), { type: "create", id: "a" });
    state = workspaceReducer(state, { type: "language", languageId: "typescript" });
    expect(resolveDoc(state, state.active)!.name).toBe("untitled.ts");
    state = workspaceReducer(state, { type: "rename", id: "a", name: "utils.js" });
    expect(resolveDoc(state, state.active)!.name).toBe("utils-2.js");
  });

  it("deleting the active file falls back to another open document", () => {
    let state = workspaceReducer(start(), { type: "open", ref: { kind: "file", id: "utils" } });
    state = workspaceReducer(state, { type: "delete", id: "utils" });
    expect(state.files.some((f) => f.id === "utils")).toBe(false);
    expect(resolveDoc(state, state.active)).not.toBeNull();
    expect(state.tabs.every((tab) => resolveDoc(state, tab) !== null)).toBe(true);
  });

  describe("closing several tabs", () => {
    it("closes the tabs to the right and keeps the active one when it stays", () => {
      const state = workspaceReducer(withTabs("index"), {
        type: "closeTabs",
        scope: "right",
        ref: file("utils"),
      });
      expect(ids(state)).toEqual(["array-map", "index", "utils"]);
      expect(state.active).toEqual(file("index"));
    });

    it("moves the active tab to the one the menu was opened on when it is closed", () => {
      const state = workspaceReducer(withTabs("example-ts"), {
        type: "closeTabs",
        scope: "right",
        ref: file("index"),
      });
      expect(ids(state)).toEqual(["array-map", "index"]);
      expect(state.active).toEqual(file("index"));
    });

    it("closes every other tab", () => {
      const state = workspaceReducer(withTabs("example-ts"), {
        type: "closeTabs",
        scope: "others",
        ref: file("utils"),
      });
      expect(ids(state)).toEqual(["utils"]);
      expect(state.active).toEqual(file("utils"));
    });

    it("closes everything, leaving no document open and the files in place", () => {
      const before = withTabs("utils");
      const state = workspaceReducer(before, {
        type: "closeTabs",
        scope: "all",
        ref: file("utils"),
      });
      expect(state.tabs).toEqual([]);
      expect(state.active).toBeNull();
      expect(state.files).toBe(before.files);
    });

    it("ignores edits and breakpoints while nothing is open, and opens a file again", () => {
      let state = workspaceReducer(withTabs("utils"), {
        type: "closeTabs",
        scope: "all",
        ref: file("utils"),
      });
      expect(workspaceReducer(state, { type: "edit", source: "x" })).toBe(state);
      expect(workspaceReducer(state, { type: "toggleBreakpoint", line: 1 })).toBe(state);
      state = workspaceReducer(state, { type: "open", ref: file("utils") });
      expect(state.tabs).toEqual([file("utils")]);
      expect(state.active).toEqual(file("utils"));
    });

    it("closing the last tab, or deleting its file, also leaves nothing open", () => {
      const only = workspaceReducer(start(), { type: "close", ref: start().active! });
      expect(only.active).toBeNull();
      const deleted = workspaceReducer(
        workspaceReducer(start(), { type: "close", ref: start().active! }),
        { type: "open", ref: file("utils") },
      );
      expect(workspaceReducer(deleted, { type: "delete", id: "utils" }).active).toBeNull();
    });

    it("ignores a tab that is not open", () => {
      const before = withTabs("index");
      expect(workspaceReducer(before, { type: "closeTabs", scope: "all", ref: file("nope") })).toBe(
        before,
      );
    });
  });

  it("toggles breakpoints per document, sorted", () => {
    let state = workspaceReducer(start(), { type: "toggleBreakpoint", line: 4 });
    state = workspaceReducer(state, { type: "toggleBreakpoint", line: 2 });
    expect(state.breakpoints[docKey(state.active!)]).toEqual([2, 4]);
    state = workspaceReducer(state, { type: "toggleBreakpoint", line: 4 });
    expect(state.breakpoints[docKey(state.active!)]).toEqual([2]);
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

  it("stops adding files once the workspace is full", () => {
    let state = start();
    for (let i = 0; i < MAX_FILES + 5; i++) {
      state = workspaceReducer(state, { type: "create", id: `n${i}` });
    }
    expect(state.files).toHaveLength(MAX_FILES);
    const copied = workspaceReducer(state, { type: "duplicate", id: "index", newId: "dup" });
    expect(copied).toBe(state);
  });

  it("starts new files with the storage note", () => {
    const state = workspaceReducer(start(), { type: "create", id: "a" });
    expect(state.files.find((f) => f.id === "a")!.source).toBe(
      newFileSource(languageById("javascript")),
    );
  });

  it("detects Python files and starts them with a Python comment", () => {
    const state = workspaceReducer(start(), { type: "create", id: "p", name: "solve.py" });
    const doc = resolveDoc(state, state.active)!;
    expect(doc.languageId).toBe("python");
    expect(doc.source.startsWith("# ")).toBe(true);
  });

  it("switches the language of an untouched file and rewrites its starter", () => {
    let state = workspaceReducer(start(), { type: "create", id: "a" });
    state = workspaceReducer(state, { type: "language", languageId: "python" });
    const doc = resolveDoc(state, state.active)!;
    expect(doc.name).toBe("untitled.py");
    expect(doc.source).toBe(newFileSource(languageById("python")));
  });

  it("keeps the language of a file that has code", () => {
    let state = workspaceReducer(start(), { type: "create", id: "a", name: "solve.py" });
    state = workspaceReducer(state, { type: "edit", source: "print(1)\n" });
    expect(canSwitchLanguage(resolveDoc(state, state.active)!)).toBe(false);
    state = workspaceReducer(state, { type: "language", languageId: "javascript" });
    const doc = resolveDoc(state, state.active)!;
    expect(doc.name).toBe("solve.py");
    expect(doc.source).toBe("print(1)\n");
  });
});

describe("saveWorkspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports whether the workspace was saved", () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn<() => void>() });
    expect(saveWorkspace(start())).toBe(true);
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(saveWorkspace(start())).toBe(false);
  });
});
