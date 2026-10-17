import type { TestSuite } from "@/engine/core/protocol/testing";
import {
  DEFAULT_LANGUAGE,
  KNOWN_EXTENSIONS,
  knownLanguageOfFile,
  languageById,
  languageOfFile,
  withLanguageExtension,
  type Language,
  type LanguageId,
} from "@/engine/languages/catalog";
import { findExample } from "@/content/examples";
import { basename, dirname, normalizePath, type PathResult } from "@/engine/core/project/paths";
import { STARTER_SOURCE, STARTER_SUITE } from "./draft";

/**
 * The playground's documents: the user's own files (persisted) and the built-in examples
 * (read-only sources; edits live for the session). All transitions are pure.
 */
export type DocRef =
  | { readonly kind: "file"; readonly id: string }
  | { readonly kind: "example"; readonly id: string };

export interface WorkspaceFile {
  readonly id: string;
  /** Normalized path from the workspace root ("utils/math.js"); folders exist only in paths. */
  readonly path: string;
  readonly source: string;
  readonly suite: TestSuite;
}

export interface WorkspaceState {
  readonly files: readonly WorkspaceFile[];
  /** The file runs start from; null runs the open file (the lone-script behavior). */
  readonly entry: string | null;
  readonly tabs: readonly DocRef[];
  /** The open document; null when every tab has been closed. */
  readonly active: DocRef | null;
  /** Session edits of examples (source and tests), by example id. */
  readonly exampleEdits: Readonly<Record<string, string>>;
  readonly exampleSuites: Readonly<Record<string, TestSuite>>;
  /** Breakpoint lines per document key. */
  readonly breakpoints: Readonly<Record<string, readonly number[]>>;
}

export interface OpenDoc {
  readonly ref: DocRef;
  readonly key: string;
  /** The file's path (an example's file name). */
  readonly path: string;
  readonly source: string;
  readonly suite: TestSuite;
  readonly languageId: LanguageId;
  readonly editable: boolean;
}

/** Which tabs a bulk close removes, relative to the tab it was started from. */
export type CloseScope = "others" | "right" | "all";

export type WorkspaceAction =
  | { readonly type: "open"; readonly ref: DocRef }
  | { readonly type: "close"; readonly ref: DocRef }
  | { readonly type: "closeTabs"; readonly scope: CloseScope; readonly ref: DocRef }
  | { readonly type: "edit"; readonly source: string }
  | { readonly type: "suite"; readonly suite: TestSuite }
  | {
      readonly type: "create";
      readonly id: string;
      readonly name?: string;
      readonly source?: string;
    }
  | { readonly type: "rename"; readonly id: string; readonly name: string }
  | { readonly type: "renameFolder"; readonly from: string; readonly to: string }
  | { readonly type: "duplicate"; readonly id: string; readonly newId: string }
  | { readonly type: "delete"; readonly id: string }
  | { readonly type: "deleteFolder"; readonly path: string }
  | { readonly type: "entry"; readonly id: string | null }
  | { readonly type: "language"; readonly languageId: LanguageId }
  | { readonly type: "toggleBreakpoint"; readonly line: number }
  | { readonly type: "clearBreakpoints" }
  | { readonly type: "reset" };

/** Browser storage is small and written whole, so files are capped (count and size). */
export const MAX_FILES = 50;
export const MAX_FILE_CHARS = 200_000;

/** What a new empty file starts with: where files live, so nobody expects a server copy. */
export const newFileSource = (language: Language): string =>
  [
    `${language.lineComment} Your files are stored only in this browser, never uploaded.`,
    `${language.lineComment} Clearing site data deletes them, so copy anything you want to keep.`,
    "",
    "",
  ].join("\n");

/**
 * Whether a file may switch language: only while it holds no code of its own (empty, or the
 * untouched starter comment). Switching renames the file; it never translates code.
 */
export const canSwitchLanguage = (file: { readonly path: string; readonly source: string }) =>
  file.source.trim() === "" || file.source === newFileSource(languageOfFile(file.path));

export const EMPTY_SUITE: TestSuite = { entry: "", target: "return", cases: [] };

export const docKey = (ref: DocRef): string => `${ref.kind}:${ref.id}`;
/** The document a key (from {@link docKey}) names. */
export const refOfKey = (key: string): DocRef => {
  const split = key.indexOf(":");
  return { kind: key.slice(0, split) === "example" ? "example" : "file", id: key.slice(split + 1) };
};
const sameDoc = (a: DocRef, b: DocRef): boolean => a.kind === b.kind && a.id === b.id;

/**
 * Makes `path` unique among the files, ignoring case ("utils/a.js" → "utils/a-2.js"). The
 * numbering goes before the extension and stays in the same folder.
 */
export const uniquePath = (files: readonly WorkspaceFile[], path: string): string => {
  const taken = new Set(files.map((file) => file.path.toLowerCase()));
  if (!taken.has(path.toLowerCase())) return path;
  const dir = dirname(path);
  const match = /^(.*?)(\.[^.]+)?$/.exec(basename(path))!;
  for (let n = 2; ; n++) {
    const candidate = `${dir ? `${dir}/` : ""}${match[1]}-${n}${match[2] ?? ""}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
};

/**
 * Checks a path the user typed for a new or renamed file: inside the workspace, and ending
 * in an extension of a language Reify runs (other files could never be imported or run).
 */
export const validateFilePath = (input: string): PathResult => {
  const normalized = normalizePath(input.trim());
  if (!normalized.ok) return normalized;
  if (!knownLanguageOfFile(normalized.path))
    return {
      ok: false,
      code: "invalid-path",
      message: `Files end in ${KNOWN_EXTENSIONS.map((ext) => `.${ext}`).join(", ")}.`,
    };
  return normalized;
};

export const resolveDoc = (state: WorkspaceState, ref: DocRef | null): OpenDoc | null => {
  if (!ref) return null;
  if (ref.kind === "file") {
    const file = state.files.find((f) => f.id === ref.id);
    if (!file) return null;
    return {
      ref,
      key: docKey(ref),
      path: file.path,
      source: file.source,
      suite: file.suite,
      languageId: languageOfFile(file.path).id,
      editable: true,
    };
  }
  const example = findExample(ref.id);
  if (!example) return null;
  return {
    ref,
    key: docKey(ref),
    path: example.fileName,
    source: state.exampleEdits[ref.id] ?? example.source,
    suite: state.exampleSuites[ref.id] ?? EMPTY_SUITE,
    languageId: languageOfFile(example.fileName).id,
    editable: true,
  };
};

const exists = (state: WorkspaceState, ref: DocRef): boolean => resolveDoc(state, ref) !== null;

const updateFile = (
  state: WorkspaceState,
  id: string,
  patch: (file: WorkspaceFile) => WorkspaceFile,
): WorkspaceState => ({
  ...state,
  files: state.files.map((file) => (file.id === id ? patch(file) : file)),
});

const open = (state: WorkspaceState, ref: DocRef): WorkspaceState =>
  exists(state, ref)
    ? {
        ...state,
        tabs: state.tabs.some((tab) => sameDoc(tab, ref)) ? state.tabs : [...state.tabs, ref],
        active: ref,
      }
    : state;

const closeTabs = (state: WorkspaceState, scope: CloseScope, ref: DocRef): WorkspaceState => {
  const index = state.tabs.findIndex((tab) => sameDoc(tab, ref));
  if (index < 0) return state;
  const keep = (i: number): boolean =>
    scope === "all" ? false : scope === "others" ? i === index : i <= index;
  const tabs = state.tabs.filter((_, i) => keep(i));
  if (tabs.length === 0) return { ...state, tabs, active: null };
  // The tab the menu was opened on stays; an active tab that was closed gives way to it.
  const active =
    state.active && tabs.some((tab) => sameDoc(tab, state.active!)) ? state.active : ref;
  return { ...state, tabs, active };
};

const close = (state: WorkspaceState, ref: DocRef): WorkspaceState => {
  const index = state.tabs.findIndex((tab) => sameDoc(tab, ref));
  if (index < 0) return state;
  const tabs = state.tabs.filter((_, i) => i !== index);
  if (tabs.length === 0) return { ...state, tabs, active: null };
  const active =
    state.active && sameDoc(state.active, ref)
      ? tabs[Math.min(index, tabs.length - 1)]!
      : state.active;
  return { ...state, tabs, active };
};

/** Removes files (their tabs, breakpoints and entry mark) and settles the open document. */
const removeFiles = (state: WorkspaceState, ids: ReadonlySet<string>): WorkspaceState => {
  const refs = state.files
    .filter((f) => ids.has(f.id))
    .map((f): DocRef => ({ kind: "file", id: f.id }));
  const closed = refs.reduce(close, state);
  const gone = new Set(refs.map(docKey));
  const breakpoints = Object.fromEntries(
    Object.entries(closed.breakpoints).filter(([key]) => !gone.has(key)),
  );
  const next: WorkspaceState = {
    ...closed,
    files: closed.files.filter((file) => !ids.has(file.id)),
    entry: closed.entry !== null && ids.has(closed.entry) ? null : closed.entry,
    breakpoints,
  };
  // An active tab that no longer resolves gives way to the next open one (or none).
  return next.active && !exists(next, next.active) ? close(next, next.active) : next;
};

const inFolder = (path: string, folder: string): boolean => path.startsWith(`${folder}/`);

export const workspaceReducer = (
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState => {
  const active = state.active;
  switch (action.type) {
    case "open":
      return open(state, action.ref);
    case "close":
      return close(state, action.ref);
    case "closeTabs":
      return closeTabs(state, action.scope, action.ref);
    case "edit":
      if (!active) return state;
      return active.kind === "file"
        ? updateFile(state, active.id, (file) => ({ ...file, source: action.source }))
        : { ...state, exampleEdits: { ...state.exampleEdits, [active.id]: action.source } };
    case "suite":
      if (!active) return state;
      return active.kind === "file"
        ? updateFile(state, active.id, (file) => ({ ...file, suite: action.suite }))
        : { ...state, exampleSuites: { ...state.exampleSuites, [active.id]: action.suite } };
    case "create": {
      if (state.files.length >= MAX_FILES) return state;
      const requested = normalizePath(action.name ?? "untitled.js");
      const path = uniquePath(state.files, requested.ok ? requested.path : "untitled.js");
      const file: WorkspaceFile = {
        id: action.id,
        path,
        source: action.source ?? newFileSource(languageOfFile(path)),
        suite: EMPTY_SUITE,
      };
      return open({ ...state, files: [...state.files, file] }, { kind: "file", id: file.id });
    }
    case "rename": {
      const requested = normalizePath(action.name.trim());
      if (!requested.ok) return state;
      const others = state.files.filter((file) => file.id !== action.id);
      return updateFile(state, action.id, (file) => ({
        ...file,
        path: uniquePath(others, requested.path),
      }));
    }
    case "renameFolder": {
      const target = normalizePath(action.to.trim());
      if (!target.ok || target.path === action.from || inFolder(target.path, action.from))
        return state;
      const moved = state.files.filter((file) => inFolder(file.path, action.from));
      const stay = state.files.filter((file) => !inFolder(file.path, action.from));
      const renamed = moved.map(
        (file) => `${target.path}/${file.path.slice(action.from.length + 1)}`,
      );
      // A folder never merges into existing files: refuse instead of renaming around them.
      const taken = new Set(stay.map((file) => file.path.toLowerCase()));
      if (moved.length === 0 || renamed.some((path) => taken.has(path.toLowerCase()))) return state;
      return {
        ...state,
        files: state.files.map((file) => {
          const index = moved.indexOf(file);
          return index < 0 ? file : { ...file, path: renamed[index]! };
        }),
      };
    }
    case "duplicate": {
      const original = state.files.find((file) => file.id === action.id);
      if (!original || state.files.length >= MAX_FILES) return state;
      const copy = { ...original, id: action.newId, path: uniquePath(state.files, original.path) };
      return open({ ...state, files: [...state.files, copy] }, { kind: "file", id: copy.id });
    }
    case "delete":
      return removeFiles(state, new Set([action.id]));
    case "deleteFolder":
      return removeFiles(
        state,
        new Set(state.files.filter((f) => inFolder(f.path, action.path)).map((f) => f.id)),
      );
    case "entry":
      return action.id === null || state.files.some((file) => file.id === action.id)
        ? { ...state, entry: action.id }
        : state;
    case "language": {
      if (active?.kind !== "file") return state;
      const target = languageById(action.languageId);
      return updateFile(state, active.id, (file) =>
        canSwitchLanguage(file)
          ? {
              ...file,
              path: uniquePath(
                state.files.filter((f) => f.id !== file.id),
                withLanguageExtension(file.path, target),
              ),
              // The starter comment is rewritten in the new language's syntax.
              source: file.source.trim() === "" ? file.source : newFileSource(target),
            }
          : file,
      );
    }
    case "toggleBreakpoint": {
      if (!active) return state;
      const key = docKey(active);
      const lines = state.breakpoints[key] ?? [];
      const next = lines.includes(action.line)
        ? lines.filter((line) => line !== action.line)
        : [...lines, action.line].toSorted((a, b) => a - b);
      return { ...state, breakpoints: { ...state.breakpoints, [key]: next } };
    }
    case "clearBreakpoints":
      if (!active) return state;
      return { ...state, breakpoints: { ...state.breakpoints, [docKey(active)]: [] } };
    case "reset":
      return initialWorkspace();
  }
};

// ---------------------------------------------------------------- persistence

const STORAGE_KEY = "reify:workspace:v2";
/** v1 stored flat file names; they are migrated on first load (and left in place). */
const LEGACY_STORAGE_KEY = "reify:workspace:v1";

const PROJECT_DEMO_MAIN = [
  "// A small project: this file imports from other files.",
  "// Pick it as the entry point (file menu), press Run, and watch the calls cross files.",
  'import { average, total } from "./stats/math.js";',
  "",
  "const scores = [82, 91, 77];",
  "console.log(total(scores), average(scores));",
  "",
].join("\n");

const PROJECT_DEMO_MATH = [
  "export function total(values) {",
  "  let sum = 0;",
  "  for (const value of values) sum += value;",
  "  return sum;",
  "}",
  "",
  "export function average(values) {",
  "  return total(values) / values.length;",
  "}",
  "",
].join("\n");

const STARTER_FILES = (): WorkspaceFile[] => [
  {
    id: "index",
    path: "index.js",
    source: STARTER_SOURCE,
    suite: STARTER_SUITE,
  },
  {
    id: "utils",
    path: "utils.js",
    source: `function clamp(value, min, max) {\n  return Math.min(Math.max(value, min), max);\n}\n\nconsole.log(clamp(12, 0, 10));\n`,
    suite: EMPTY_SUITE,
  },
  {
    id: "example-ts",
    path: "example.ts",
    source: `interface Point {\n  x: number;\n  y: number;\n}\n\nconst points: Point[] = [\n  { x: 1, y: 2 },\n  { x: 3, y: 4 },\n];\n\nconst sum = points.reduce((total, p) => total + p.x + p.y, 0);\nconsole.log(sum);\n`,
    suite: EMPTY_SUITE,
  },
  { id: "demo-main", path: "demo/main.js", source: PROJECT_DEMO_MAIN, suite: EMPTY_SUITE },
  { id: "demo-math", path: "demo/stats/math.js", source: PROJECT_DEMO_MATH, suite: EMPTY_SUITE },
];

export const initialWorkspace = (files: WorkspaceFile[] = STARTER_FILES()): WorkspaceState => {
  const active: DocRef = { kind: "example", id: "array-map" };
  return {
    files,
    entry: null,
    tabs: [active],
    active,
    exampleEdits: {},
    exampleSuites: {},
    breakpoints: {},
  };
};

/** A saved file with a free-form `name` (v1) or a normalized `path` (v2). */
interface SavedFile {
  readonly id: string;
  readonly name?: string;
  readonly path?: string;
  readonly source: string;
  readonly suite: TestSuite;
}

const isSavedFile = (value: unknown): value is SavedFile => {
  const file = value as Partial<SavedFile> | null;
  return (
    typeof file?.id === "string" &&
    (typeof file.name === "string" || typeof file.path === "string") &&
    typeof file.source === "string" &&
    typeof file.suite?.entry === "string" &&
    Array.isArray(file.suite.cases)
  );
};

/**
 * Brings saved files to normalized, unique paths. v1 names were whatever the user typed: a
 * name that is not a valid path ("../x.js", "C:\x.js") falls back to a plain file name, and
 * two names that now collide (also ignoring case) are numbered, never merged or dropped.
 */
export const migrateFiles = (saved: readonly SavedFile[]): WorkspaceFile[] => {
  const files: WorkspaceFile[] = [];
  for (const { name, path, ...rest } of saved) {
    const normalized = normalizePath(path ?? name ?? "");
    const wanted = normalized.ok ? normalized.path : "untitled.js";
    files.push({ ...rest, path: uniquePath(files, wanted) });
  }
  return files;
};

const isRef = (value: unknown): value is DocRef => {
  const ref = value as Partial<DocRef> | null;
  return (ref?.kind === "file" || ref?.kind === "example") && typeof ref.id === "string";
};

const readSaved = (): (Partial<WorkspaceState> & { files?: unknown }) | null => {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Partial<WorkspaceState>) : null;
};

/** Loads the saved workspace (migrating older formats); storage failures fall back. */
export const loadWorkspace = (): WorkspaceState => {
  try {
    const parsed = readSaved();
    if (parsed) {
      const files = migrateFiles(
        Array.isArray(parsed.files) ? parsed.files.filter(isSavedFile) : [],
      );
      const base = { ...initialWorkspace(files), breakpoints: parsed.breakpoints ?? {} };
      const entry = files.some((file) => file.id === parsed.entry) ? (parsed.entry ?? null) : null;
      const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : []).filter(
        (ref): ref is DocRef => isRef(ref) && exists(base, ref),
      );
      const active = isRef(parsed.active) && exists(base, parsed.active) ? parsed.active : tabs[0];
      if (active) return open({ ...base, entry, tabs }, active);
      // Everything was closed last time: keep it that way (files are still in the sidebar).
      return parsed.active === null && tabs.length === 0
        ? { ...base, entry, tabs, active: null }
        : { ...base, entry };
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return initialWorkspace();
};

/**
 * Persists files, tabs and breakpoints (example edits are session-only). Returns whether it
 * was saved: storage can be full or unavailable (private mode), and the caller tells the user.
 */
export const saveWorkspace = (state: WorkspaceState): boolean => {
  try {
    const { exampleEdits: _edits, exampleSuites: _suites, ...kept } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
};

export const newFileId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Stands in for the open document while none is, so views that read it need no null checks. */
export const BLANK_DOC: OpenDoc = {
  ref: { kind: "file", id: "" },
  key: "none",
  path: "",
  source: "",
  suite: EMPTY_SUITE,
  languageId: DEFAULT_LANGUAGE.id,
  editable: false,
};
