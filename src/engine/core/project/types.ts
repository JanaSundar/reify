import type { Diagnostic, SourceRange } from "../protocol/program";

/** A source file of a project; `path` is normalized (see `paths.ts`). */
export interface ProjectFile {
  readonly path: string;
  readonly source: string;
}

export interface Project {
  readonly files: readonly ProjectFile[];
  /** Path of the file that runs first. */
  readonly entry: string;
}

/** A diagnostic located in a project file (the range, when known, is within `path`). */
export interface ProjectDiagnostic extends Diagnostic {
  readonly path: string;
}

/** One import found in a module's source. */
export interface ImportRef {
  readonly specifier: string;
  /** `dynamic` imports (`import(x)`) are reported, never resolved. */
  readonly kind: "static" | "dynamic";
  readonly range: SourceRange | null;
  /** Requested export names: `default`, `*` for a namespace, empty for a side-effect import. */
  readonly names: readonly string[];
}

export interface ModuleScan {
  readonly imports: readonly ImportRef[];
  /** Syntax errors and unsupported constructs found while scanning. */
  readonly diagnostics: readonly Diagnostic[];
}

export type Resolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * How one language family finds and resolves imports. Languages do not share module
 * semantics, so each implements its own; the project model only sees this interface.
 */
export interface ProjectLanguage {
  readonly id: string;
  scan(file: ProjectFile): ModuleScan;
  /** Maps an import specifier in `from` to a project file. `exists` tests project paths. */
  resolve(specifier: string, from: string, exists: (path: string) => boolean): Resolution;
}

export interface ResolvedImport {
  readonly ref: ImportRef;
  readonly target: string;
}

export interface ModuleNode {
  readonly path: string;
  readonly language: ProjectLanguage;
  /** Resolved static imports, in source order (which is evaluation order). */
  readonly imports: readonly ResolvedImport[];
}

export interface ProjectGraph {
  readonly entry: string;
  /** The modules reachable from the entry, in discovery order. */
  readonly modules: ReadonlyMap<string, ModuleNode>;
  readonly diagnostics: readonly ProjectDiagnostic[];
}
