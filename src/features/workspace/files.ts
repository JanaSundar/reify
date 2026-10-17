import type { TestSuite } from "@/engine/core/protocol/testing";
import {
  DEFAULT_LANGUAGE,
  languageById,
  languageOfFile,
  withLanguageExtension,
  type Language,
  type LanguageId,
} from "@/engine/languages/catalog";
import { findExample } from "@/content/examples";
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
  readonly name: string;
  readonly source: string;
  readonly suite: TestSuite;
}

export interface WorkspaceState {
  readonly files: readonly WorkspaceFile[];
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
  readonly name: string;
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
  | { readonly type: "duplicate"; readonly id: string; readonly newId: string }
  | { readonly type: "delete"; readonly id: string }
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
export const canSwitchLanguage = (file: { readonly name: string; readonly source: string }) =>
  file.source.trim() === "" || file.source === newFileSource(languageOfFile(file.name));

export const EMPTY_SUITE: TestSuite = { entry: "", target: "return", cases: [] };

export const docKey = (ref: DocRef): string => `${ref.kind}:${ref.id}`;
const sameDoc = (a: DocRef, b: DocRef): boolean => a.kind === b.kind && a.id === b.id;

/** Makes `name` unique among the files ("untitled.js" → "untitled-2.js"). */
export const uniqueName = (files: readonly WorkspaceFile[], name: string): string => {
  const taken = new Set(files.map((file) => file.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const match = /^(.*?)(\.[^.]+)?$/.exec(name)!;
  for (let n = 2; ; n++) {
    const candidate = `${match[1]}-${n}${match[2] ?? ""}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
};

export const resolveDoc = (state: WorkspaceState, ref: DocRef | null): OpenDoc | null => {
  if (!ref) return null;
  if (ref.kind === "file") {
    const file = state.files.find((f) => f.id === ref.id);
    if (!file) return null;
    return {
      ref,
      key: docKey(ref),
      name: file.name,
      source: file.source,
      suite: file.suite,
      languageId: languageOfFile(file.name).id,
      editable: true,
    };
  }
  const example = findExample(ref.id);
  if (!example) return null;
  return {
    ref,
    key: docKey(ref),
    name: example.fileName,
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
      const name = uniqueName(state.files, action.name ?? "untitled.js");
      const file: WorkspaceFile = {
        id: action.id,
        name,
        source: action.source ?? newFileSource(languageOfFile(name)),
        suite: EMPTY_SUITE,
      };
      return open({ ...state, files: [...state.files, file] }, { kind: "file", id: file.id });
    }
    case "rename": {
      const name = action.name.trim();
      if (!name) return state;
      const others = state.files.filter((file) => file.id !== action.id);
      return updateFile(state, action.id, (file) => ({ ...file, name: uniqueName(others, name) }));
    }
    case "duplicate": {
      const original = state.files.find((file) => file.id === action.id);
      if (!original || state.files.length >= MAX_FILES) return state;
      const copy = { ...original, id: action.newId, name: uniqueName(state.files, original.name) };
      return open({ ...state, files: [...state.files, copy] }, { kind: "file", id: copy.id });
    }
    case "delete": {
      const ref: DocRef = { kind: "file", id: action.id };
      const closed = close(state, ref);
      const files = closed.files.filter((file) => file.id !== action.id);
      const { [docKey(ref)]: _removed, ...breakpoints } = closed.breakpoints;
      const next = { ...closed, files, breakpoints };
      // An active tab that no longer resolves gives way to the next open one (or none).
      return next.active && !exists(next, next.active) ? close(next, next.active) : next;
    }
    case "language": {
      if (active?.kind !== "file") return state;
      const target = languageById(action.languageId);
      return updateFile(state, active.id, (file) =>
        canSwitchLanguage(file)
          ? {
              ...file,
              name: uniqueName(
                state.files.filter((f) => f.id !== file.id),
                withLanguageExtension(file.name, target),
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

const STORAGE_KEY = "reify:workspace:v1";

const STARTER_FILES = (): WorkspaceFile[] => [
  {
    id: "index",
    name: "index.js",
    source: STARTER_SOURCE,
    suite: STARTER_SUITE,
  },
  {
    id: "utils",
    name: "utils.js",
    source: `function clamp(value, min, max) {\n  return Math.min(Math.max(value, min), max);\n}\n\nconsole.log(clamp(12, 0, 10));\n`,
    suite: EMPTY_SUITE,
  },
  {
    id: "example-ts",
    name: "example.ts",
    source: `interface Point {\n  x: number;\n  y: number;\n}\n\nconst points: Point[] = [\n  { x: 1, y: 2 },\n  { x: 3, y: 4 },\n];\n\nconst sum = points.reduce((total, p) => total + p.x + p.y, 0);\nconsole.log(sum);\n`,
    suite: EMPTY_SUITE,
  },
];

export const initialWorkspace = (files: WorkspaceFile[] = STARTER_FILES()): WorkspaceState => {
  const active: DocRef = { kind: "example", id: "array-map" };
  return { files, tabs: [active], active, exampleEdits: {}, exampleSuites: {}, breakpoints: {} };
};

const isFile = (value: unknown): value is WorkspaceFile => {
  const file = value as Partial<WorkspaceFile> | null;
  return (
    typeof file?.id === "string" &&
    typeof file.name === "string" &&
    typeof file.source === "string" &&
    typeof file.suite?.entry === "string" &&
    Array.isArray(file.suite.cases)
  );
};

const isRef = (value: unknown): value is DocRef => {
  const ref = value as Partial<DocRef> | null;
  return (ref?.kind === "file" || ref?.kind === "example") && typeof ref.id === "string";
};

/** Loads the saved workspace (migrating the old single draft); storage failures fall back. */
export const loadWorkspace = (): WorkspaceState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
      const files = Array.isArray(parsed.files) ? parsed.files.filter(isFile) : [];
      const base = { ...initialWorkspace(files), breakpoints: parsed.breakpoints ?? {} };
      const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : []).filter(
        (ref): ref is DocRef => isRef(ref) && exists(base, ref),
      );
      const active = isRef(parsed.active) && exists(base, parsed.active) ? parsed.active : tabs[0];
      if (active) return open({ ...base, tabs }, active);
      // Everything was closed last time: keep it that way (files are still in the sidebar).
      return parsed.active === null && tabs.length === 0 ? { ...base, tabs, active: null } : base;
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
  name: "",
  source: "",
  suite: EMPTY_SUITE,
  languageId: DEFAULT_LANGUAGE.id,
  editable: false,
};
