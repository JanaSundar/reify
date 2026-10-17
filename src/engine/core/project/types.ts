import type { BindingInfo, Diagnostic, FileId, LocInfo, SourceRange } from "../protocol/program";

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

/**
 * Where a module's ids start. Locations and bindings are numbered project-wide, so each
 * module is compiled knowing how many the modules before it hold (see docs/multi-file-projects.md).
 */
export interface ModuleSlot {
  readonly fileId: FileId;
  readonly locBase: number;
  readonly bindingBase: number;
}

/** One compiled module: runnable code plus the table entries for its own ids. */
export interface CompiledModule {
  readonly code: string;
  readonly locs: readonly LocInfo[];
  readonly bindings: readonly BindingInfo[];
  readonly warnings: readonly Diagnostic[];
}

export type ModuleCompileResult =
  | { readonly ok: true; readonly module: CompiledModule }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** One import found in a module's source. */
export interface ImportRef {
  readonly specifier: string;
  /** `dynamic` imports (`import(x)`) are reported, never resolved. */
  readonly kind: "static" | "dynamic";
  readonly range: SourceRange | null;
  /** Requested export names: `default`, `*` for a namespace, empty for a side-effect import. */
  readonly names: readonly string[];
  /** `export * from "x"`: every export of the target is re-exported (not an import of names). */
  readonly reexportAll?: boolean;
}

export interface ModuleScan {
  readonly imports: readonly ImportRef[];
  /**
   * The names the module exports itself (`default` included), not counting `export *`.
   * Absent when the language cannot tell, which turns off the missing-export check.
   */
  readonly exports?: readonly string[];
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
  /**
   * Compiles one module. `urlOf` gives the url of each import's target (by the specifier
   * written in the source); the compiled code must import its dependencies from those urls.
   */
  compile(
    file: ProjectFile,
    slot: ModuleSlot,
    urlOf: (specifier: string) => string,
  ): ModuleCompileResult;
}

export interface ResolvedImport {
  readonly ref: ImportRef;
  readonly target: string;
}

export interface ModuleNode {
  readonly path: string;
  readonly file: ProjectFile;
  readonly language: ProjectLanguage;
  /** What the module exports itself; see {@link ModuleScan.exports}. */
  readonly exports?: readonly string[];
  /** Resolved static imports, in source order (which is evaluation order). */
  readonly imports: readonly ResolvedImport[];
}

export interface ProjectGraph {
  readonly entry: string;
  /** The modules reachable from the entry, in discovery order. */
  readonly modules: ReadonlyMap<string, ModuleNode>;
  readonly diagnostics: readonly ProjectDiagnostic[];
}
