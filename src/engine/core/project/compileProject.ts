import type { BindingInfo, LocInfo, ProgramInfo } from "../protocol/program";
import { hasErrors } from "./graph";
import type { ModuleCompileResult, ModuleSlot, ProjectDiagnostic, ProjectGraph } from "./types";

export interface BuiltModule {
  readonly path: string;
  readonly url: string;
  readonly code: string;
}

export interface ProjectBuild {
  readonly entryUrl: string;
  /** In discovery order (entry first). */
  readonly modules: readonly BuiltModule[];
  /** The linked tables: every module's locations and bindings, project-wide. */
  readonly program: ProgramInfo;
}

export type ProjectBuildResult =
  | { readonly ok: true; readonly build: ProjectBuild }
  | { readonly ok: false; readonly diagnostics: readonly ProjectDiagnostic[] };

/**
 * Remembers each module's compile result while nothing it depends on has changed: its
 * source, its id slot and the urls it imports. Editing one file leaves the others' entries
 * valid unless its size change moved their slots.
 */
export class CompileCache {
  private readonly entries = new Map<string, { key: string; result: ModuleCompileResult }>();

  get(path: string, key: string, compute: () => ModuleCompileResult): ModuleCompileResult {
    const hit = this.entries.get(path);
    if (hit?.key === key) return hit.result;
    const result = compute();
    this.entries.set(path, { key, result });
    return result;
  }

  retain(paths: ReadonlySet<string>): void {
    for (const path of this.entries.keys()) if (!paths.has(path)) this.entries.delete(path);
  }
}

/**
 * Compiles every module of a graph and links their tables. `urlFor` is where each module
 * will be served. The graph must be free of errors; otherwise nothing is compiled and its
 * diagnostics are returned, so an incomplete project is never built.
 */
export const compileProject = (
  graph: ProjectGraph,
  urlFor: (path: string) => string,
  cache = new CompileCache(),
): ProjectBuildResult => {
  if (hasErrors(graph)) return { ok: false, diagnostics: graph.diagnostics };

  const modules: BuiltModule[] = [];
  const locs: LocInfo[] = [];
  const bindings: BindingInfo[] = [];
  const warnings: ProjectDiagnostic[] = [];
  const failures: ProjectDiagnostic[] = [];

  for (const node of graph.modules.values()) {
    const slot: ModuleSlot = {
      fileId: modules.length + failures.length,
      locBase: locs.length,
      bindingBase: bindings.length,
    };
    const urls = new Map(node.imports.map(({ ref, target }) => [ref.specifier, urlFor(target)]));
    const key = JSON.stringify([node.file.source, slot, [...urls]]);
    const result = cache.get(node.path, key, () =>
      node.language.compile(node.file, slot, (specifier) => urls.get(specifier)!),
    );
    if (!result.ok) {
      failures.push(...result.diagnostics.map((d) => ({ ...d, path: node.path })));
      continue;
    }
    locs.push(...result.module.locs);
    bindings.push(...result.module.bindings);
    warnings.push(...result.module.warnings.map((w) => ({ ...w, path: node.path })));
    modules.push({ path: node.path, url: urlFor(node.path), code: result.module.code });
  }
  if (failures.length > 0) return { ok: false, diagnostics: failures };

  const entry = graph.modules.get(graph.entry)!;
  return {
    ok: true,
    build: {
      entryUrl: urlFor(graph.entry),
      modules,
      program: {
        languageId: entry.language.id,
        files: modules.map((m, id) => ({ id, path: m.path })),
        locs,
        bindings,
        warnings,
        complexity: null,
      },
    },
  };
};
