import type { SourceRange } from "../protocol/program";
import { normalizePath } from "./paths";
import type {
  ModuleNode,
  Project,
  ProjectDiagnostic,
  ProjectFile,
  ProjectGraph,
  ProjectLanguage,
  ResolvedImport,
} from "./types";

/** What the graph needs to know about the outside world. */
export interface GraphHost {
  /** The language that owns a file's imports; `undefined` for files that cannot be run. */
  languageOf(path: string): ProjectLanguage | undefined;
}

const error = (
  path: string,
  code: string,
  message: string,
  range: SourceRange | null = null,
): ProjectDiagnostic => ({ severity: "error", code, message, range, path });

/** Normalizes file paths, reporting invalid and duplicate ones. */
const indexFiles = (
  project: Project,
  diagnostics: ProjectDiagnostic[],
): ReadonlyMap<string, ProjectFile> => {
  const files = new Map<string, ProjectFile>();
  for (const file of project.files) {
    const normalized = normalizePath(file.path);
    if (!normalized.ok) {
      diagnostics.push(error(file.path, normalized.code, normalized.message));
    } else if (files.has(normalized.path)) {
      diagnostics.push(
        error(normalized.path, "duplicate-path", `${normalized.path} exists twice.`),
      );
    } else {
      files.set(normalized.path, { ...file, path: normalized.path });
    }
  }
  return files;
};

/** Whether a module provides `name`, directly or through `export *`. Unknown counts as yes. */
const provides = (
  modules: ReadonlyMap<string, ModuleNode>,
  path: string,
  name: string,
  seen = new Set<string>(),
): boolean => {
  const node = modules.get(path);
  if (!node?.exports) return true;
  // A module already being searched (a cycle of `export *`) adds nothing new.
  if (seen.has(path)) return false;
  if (node.exports.includes(name)) return true;
  seen.add(path);
  // `export *` never re-exports a module's default.
  return (
    name !== "default" &&
    node.imports.some(({ ref, target }) => ref.reexportAll && provides(modules, target, name, seen))
  );
};

/** Named imports (and re-exports) of names the target module does not export. */
const missingExports = (modules: ReadonlyMap<string, ModuleNode>): ProjectDiagnostic[] =>
  [...modules.values()].flatMap((node) =>
    node.imports.flatMap(({ ref, target }) =>
      ref.reexportAll
        ? []
        : ref.names
            .filter((name) => name !== "*" && !provides(modules, target, name))
            .map((name) =>
              error(
                node.path,
                "missing-export",
                `${target} has no export named “${name}”.`,
                ref.range,
              ),
            ),
    ),
  );

/**
 * Discovers the modules reachable from the project's entry by scanning and resolving
 * imports. Pure: scanning and resolution belong to the languages, so nothing is executed
 * and nothing outside the project is read. Problems are returned as diagnostics, never
 * thrown; a graph with error diagnostics must not be run.
 */
export const buildGraph = (project: Project, host: GraphHost): ProjectGraph => {
  const diagnostics: ProjectDiagnostic[] = [];
  const files = indexFiles(project, diagnostics);
  const entry = normalizePath(project.entry);
  const modules = new Map<string, ModuleNode>();

  if (!entry.ok) {
    diagnostics.push(error(project.entry, "invalid-entry", `Entry point: ${entry.message}`));
    return { entry: project.entry, modules, diagnostics };
  }
  if (!files.has(entry.path)) {
    diagnostics.push(
      error(entry.path, "invalid-entry", `The entry point ${entry.path} does not exist.`),
    );
    return { entry: entry.path, modules, diagnostics };
  }

  const exists = (path: string): boolean => files.has(path);
  const queued = new Set([entry.path]);
  const queue = [entry.path];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const language = host.languageOf(path);
    if (!language) {
      diagnostics.push(
        error(path, "unsupported-language", `${path} is not a file that can be run.`),
      );
      continue;
    }
    const scan = language.scan(files.get(path)!);
    for (const diagnostic of scan.diagnostics) diagnostics.push({ ...diagnostic, path });

    const imports: ResolvedImport[] = [];
    for (const ref of scan.imports) {
      if (ref.kind === "dynamic") {
        diagnostics.push(
          error(
            path,
            "unsupported-dynamic-import",
            "Dynamic import() is not supported.",
            ref.range,
          ),
        );
        continue;
      }
      const resolution = language.resolve(ref.specifier, path, exists);
      if (!resolution.ok) {
        diagnostics.push(error(path, resolution.code, resolution.message, ref.range));
      } else if (!host.languageOf(resolution.path)) {
        diagnostics.push(
          error(
            path,
            "unsupported-language",
            `${resolution.path} is not a file that can be run.`,
            ref.range,
          ),
        );
      } else if (host.languageOf(resolution.path) !== language) {
        diagnostics.push(
          error(
            path,
            "cross-language-import",
            `${resolution.path} is written in a different language than ${path}.`,
            ref.range,
          ),
        );
      } else {
        imports.push({ ref, target: resolution.path });
        if (!queued.has(resolution.path)) {
          queued.add(resolution.path);
          queue.push(resolution.path);
        }
      }
    }
    modules.set(path, { path, file: files.get(path)!, language, exports: scan.exports, imports });
  }
  diagnostics.push(...missingExports(modules));
  return { entry: entry.path, modules, diagnostics };
};

export const hasErrors = (graph: ProjectGraph): boolean =>
  graph.diagnostics.some((diagnostic) => diagnostic.severity === "error");
