import type { Project } from "@/engine/core/project/types";
import { type LanguageId } from "@/engine/languages/catalog";
import { docKey, resolveDoc, type DocRef, type WorkspaceState } from "./files";
import { languageOfFile } from "@/engine/languages/catalog";

/** What a Run sends: the entry's source and language, plus the project when it can import. */
export interface RunPlan {
  readonly languageId: LanguageId;
  /** The entry's source (what a lone script runs). */
  readonly source: string;
  readonly project?: Project;
  /** The entry document, and the document each project path belongs to (to map a trace back). */
  readonly entryKey: string;
  readonly keysByPath: ReadonlyMap<string, string>;
}

/**
 * Decides what Run runs: the pinned entry file, else the open file. A JavaScript or
 * TypeScript file runs as a project (the worker runs a file that imports nothing as the lone
 * script it always was); anything else runs alone. `activeSource` is the open editor's text,
 * which may be newer than the saved file.
 */
export const planRun = (state: WorkspaceState, activeSource: string): RunPlan | null => {
  const entryRef: DocRef | null = state.entry ? { kind: "file", id: state.entry } : state.active;
  const entry = resolveDoc(state, entryRef);
  if (!entryRef || !entry) return null;
  const activeId = state.active?.kind === "file" ? state.active.id : null;
  const textOf = (id: string, saved: string): string => (id === activeId ? activeSource : saved);
  const isActiveEntry = state.active !== null && docKey(state.active) === entry.key;
  const source = isActiveEntry ? activeSource : entry.source;
  const base = { languageId: entry.languageId, source, entryKey: entry.key };
  if (entryRef.kind !== "file" || !languageOfFile(entry.path).projects)
    return { ...base, keysByPath: new Map([[entry.path, entry.key]]) };

  return {
    ...base,
    project: {
      files: state.files.map((file) => ({ path: file.path, source: textOf(file.id, file.source) })),
      entry: entry.path,
    },
    keysByPath: new Map(
      state.files.map((file) => [file.path, docKey({ kind: "file", id: file.id })]),
    ),
  };
};

/** What a trace was made from, so it can be mapped back to documents and checked for staleness. */
export interface TracedRun {
  readonly entryKey: string;
  readonly keysByPath: ReadonlyMap<string, string>;
  /** The text of every document the run read, by document key. */
  readonly sources: Readonly<Record<string, string>>;
}

export const tracedRunOf = (plan: RunPlan): TracedRun => ({
  entryKey: plan.entryKey,
  keysByPath: plan.keysByPath,
  sources: plan.project
    ? Object.fromEntries(
        plan.project.files.flatMap((file) => {
          const key = plan.keysByPath.get(file.path);
          return key ? [[key, file.source]] : [];
        }),
      )
    : { [plan.entryKey]: plan.source },
});

/** A run of one document alone (a test case, a launch option). */
export const lonelyRun = (key: string, path: string, source: string): TracedRun => ({
  entryKey: key,
  keysByPath: new Map([[path, key]]),
  sources: { [key]: source },
});

/**
 * The document a trace file belongs to. A lone script's single file is the entry whatever its
 * compiled name ("main.js"); a project's files are matched by path.
 */
export const docKeyOfFile = (
  traced: TracedRun | null,
  files: readonly { readonly path: string }[],
  fileId: number,
): string | null => {
  const file = files[fileId];
  if (!traced || !file) return null;
  return files.length === 1 ? traced.entryKey : (traced.keysByPath.get(file.path) ?? null);
};

/** Whether any document the trace was made from has changed since. */
export const sourcesChanged = (
  traced: TracedRun,
  currentSource: (key: string) => string | undefined,
): boolean => Object.entries(traced.sources).some(([key, source]) => currentSource(key) !== source);
