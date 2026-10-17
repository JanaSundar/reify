import { afterEach, describe, expect, it, vi } from "vitest";
import { languageById } from "@/engine/languages/catalog";
import {
  canSwitchLanguage,
  docKey,
  initialWorkspace,
  loadWorkspace,
  MAX_FILES,
  migrateFiles,
  newFileSource,
  resolveDoc,
  saveWorkspace,
  uniquePath,
  validateFilePath,
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
    expect(doc.path).toBe("array-map.js");
    expect(doc.languageId).toBe("javascript");
  });

  it("creates uniquely named files and opens them in a tab", () => {
    let state = workspaceReducer(start(), { type: "create", id: "a" });
    state = workspaceReducer(state, { type: "create", id: "b" });
    expect(state.files.map((f) => f.path)).toContain("untitled-2.js");
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
    expect(resolveDoc(state, state.active)!.path).toBe("untitled.ts");
    state = workspaceReducer(state, { type: "rename", id: "a", name: "utils.js" });
    expect(resolveDoc(state, state.active)!.path).toBe("utils-2.js");
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

  it("uniquePath suffixes before the extension", () => {
    const files = [
      {
        id: "1",
        path: "a.js",
        source: "",
        suite: { entry: "", target: "return" as const, cases: [] },
      },
    ];
    expect(uniquePath(files, "a.js")).toBe("a-2.js");
    expect(uniquePath(files, "b.js")).toBe("b.js");
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
    expect(doc.path).toBe("untitled.py");
    expect(doc.source).toBe(newFileSource(languageById("python")));
  });

  it("keeps the language of a file that has code", () => {
    let state = workspaceReducer(start(), { type: "create", id: "a", name: "solve.py" });
    state = workspaceReducer(state, { type: "edit", source: "print(1)\n" });
    expect(canSwitchLanguage(resolveDoc(state, state.active)!)).toBe(false);
    state = workspaceReducer(state, { type: "language", languageId: "javascript" });
    const doc = resolveDoc(state, state.active)!;
    expect(doc.path).toBe("solve.py");
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

describe("paths, folders and the entry point", () => {
  const withFiles = (paths: Record<string, string>): WorkspaceState => {
    let state = workspaceReducer(start(), { type: "reset" });
    state = { ...state, files: [] };
    for (const [path, source] of Object.entries(paths))
      state = workspaceReducer(state, { type: "create", id: path, name: path, source });
    return state;
  };
  const pathsOf = (state: WorkspaceState) => state.files.map((f) => f.path).toSorted();

  it("creates files in folders and normalizes what was typed", () => {
    const state = withFiles({ "./utils//math.js": "", "a\\b.js": "" });
    expect(pathsOf(state)).toEqual(["a/b.js", "utils/math.js"]);
  });

  it("falls back to a plain name for a path that leaves the workspace", () => {
    const state = workspaceReducer(withFiles({}), { type: "create", id: "x", name: "../x.js" });
    expect(pathsOf(state)).toEqual(["untitled.js"]);
  });

  it("numbers duplicates within their folder, ignoring case", () => {
    const state = withFiles({ "lib/a.js": "", "lib/A.js": "" });
    expect(pathsOf(state)).toEqual(["lib/A-2.js", "lib/a.js"]);
  });

  it("validates typed paths: inside the workspace, with a known extension", () => {
    expect(validateFilePath("lib/a.ts")).toEqual({ ok: true, path: "lib/a.ts" });
    expect(validateFilePath("../a.js")).toMatchObject({ ok: false, code: "path-escapes-root" });
    expect(validateFilePath("notes.txt")).toMatchObject({ ok: false });
    expect(validateFilePath("  ")).toMatchObject({ ok: false });
  });

  it("renames a file into another folder, and ignores an invalid path", () => {
    let state = withFiles({ "a.js": "" });
    state = workspaceReducer(state, { type: "rename", id: "a.js", name: "lib/deep/a.js" });
    expect(pathsOf(state)).toEqual(["lib/deep/a.js"]);
    expect(workspaceReducer(state, { type: "rename", id: "a.js", name: "../a.js" })).toBe(state);
  });

  it("renames a folder, moving everything under it", () => {
    let state = withFiles({ "lib/a.js": "", "lib/sub/b.js": "", "libs/c.js": "", "d.js": "" });
    state = workspaceReducer(state, { type: "renameFolder", from: "lib", to: "src/core" });
    expect(pathsOf(state)).toEqual(["d.js", "libs/c.js", "src/core/a.js", "src/core/sub/b.js"]);
  });

  it("refuses to rename a folder into itself or onto existing files", () => {
    const state = withFiles({ "lib/a.js": "", "src/a.js": "" });
    expect(workspaceReducer(state, { type: "renameFolder", from: "lib", to: "src" })).toBe(state);
    expect(workspaceReducer(state, { type: "renameFolder", from: "lib", to: "lib/in" })).toBe(
      state,
    );
  });

  it("deletes a folder with its files, tabs, breakpoints and entry mark", () => {
    let state = withFiles({ "lib/a.js": "", "lib/b.js": "", "main.js": "" });
    state = workspaceReducer(state, { type: "entry", id: "lib/a.js" });
    state = workspaceReducer(state, { type: "open", ref: file("lib/a.js") });
    state = workspaceReducer(state, { type: "toggleBreakpoint", line: 1 });
    state = workspaceReducer(state, { type: "deleteFolder", path: "lib" });
    expect(pathsOf(state)).toEqual(["main.js"]);
    expect(state.entry).toBeNull();
    expect(state.tabs.every((tab) => resolveDoc(state, tab) !== null)).toBe(true);
    expect(Object.keys(state.breakpoints).some((key) => key.includes("lib/"))).toBe(false);
  });

  it("sets and clears the entry point, only to files that exist", () => {
    let state = withFiles({ "main.js": "" });
    state = workspaceReducer(state, { type: "entry", id: "main.js" });
    expect(state.entry).toBe("main.js");
    expect(workspaceReducer(state, { type: "entry", id: "ghost" })).toBe(state);
    expect(workspaceReducer(state, { type: "entry", id: null }).entry).toBeNull();
  });

  it("clears the entry point when its file is deleted", () => {
    let state = withFiles({ "main.js": "", "b.js": "" });
    state = workspaceReducer(state, { type: "entry", id: "main.js" });
    expect(workspaceReducer(state, { type: "delete", id: "main.js" }).entry).toBeNull();
    expect(workspaceReducer(state, { type: "delete", id: "b.js" }).entry).toBe("main.js");
  });
});

describe("migrating saved files", () => {
  const saved = (id: string, name: string) => ({
    id,
    name,
    source: "",
    suite: { entry: "", target: "return" as const, cases: [] },
  });

  it("turns v1 names into normalized paths", () => {
    const files = migrateFiles([
      saved("1", "index.js"),
      saved("2", "lib\\a.js"),
      saved("3", "./b.js"),
    ]);
    expect(files.map((f) => f.path)).toEqual(["index.js", "lib/a.js", "b.js"]);
    expect(files.map((f) => f.id)).toEqual(["1", "2", "3"]);
  });

  it("repairs names that are not valid paths and never merges two files", () => {
    const files = migrateFiles([
      saved("1", "../escape.js"),
      saved("2", "C:\\x.js"),
      saved("3", "Same.js"),
      saved("4", "same.js"),
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "untitled.js",
      "untitled-2.js",
      "Same.js",
      "same-2.js",
    ]);
  });

  it("keeps v2 paths as they are", () => {
    const [file] = migrateFiles([{ ...saved("1", "x"), name: undefined, path: "a/b.js" }]);
    expect(file!.path).toBe("a/b.js");
  });

  describe("loadWorkspace", () => {
    afterEach(() => vi.unstubAllGlobals());
    const storage = (items: Record<string, string>) =>
      vi.stubGlobal("localStorage", { getItem: (key: string) => items[key] ?? null });
    const payload = (extra: object) =>
      JSON.stringify({ files: [saved("f", "my notes.js")], tabs: [], active: null, ...extra });

    it("reads the v2 save, with its entry point", () => {
      storage({ "reify:workspace:v2": payload({ entry: "f" }) });
      const state = loadWorkspace();
      expect(state.files.map((f) => f.path)).toEqual(["my notes.js"]);
      expect(state.entry).toBe("f");
    });

    it("migrates a v1 save when there is no v2 save", () => {
      storage({ "reify:workspace:v1": payload({}) });
      expect(loadWorkspace().files.map((f) => f.path)).toEqual(["my notes.js"]);
    });

    it("prefers v2 over v1 and drops an entry point to a missing file", () => {
      storage({
        "reify:workspace:v1": payload({}),
        "reify:workspace:v2": JSON.stringify({
          files: [{ ...saved("g", "x"), name: undefined, path: "g.js" }],
          entry: "gone",
          tabs: [],
          active: null,
        }),
      });
      const state = loadWorkspace();
      expect(state.files.map((f) => f.path)).toEqual(["g.js"]);
      expect(state.entry).toBeNull();
    });

    it("starts fresh from corrupt storage", () => {
      storage({ "reify:workspace:v2": "{not json" });
      expect(loadWorkspace().files.length).toBeGreaterThan(0);
    });
  });
});
