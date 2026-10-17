import type { StaticComplexity } from "../analysis/staticEstimate";

/**
 * Static information about a compiled program, produced by a language compiler.
 * Trace events refer to entries in these tables by index to keep events compact.
 */

/** Index into {@link ProgramInfo.locs}. */
export type LocId = number;
/** Index into {@link ProgramInfo.bindings}. */
export type BindingId = number;
/** Index into {@link ProgramInfo.files}. */
export type FileId = number;

/** A source file a program was compiled from; `path` is relative to the project root. */
export interface ProgramFile {
  readonly id: FileId;
  readonly path: string;
}

/** The id of the only file in a single-file program. */
export const SINGLE_FILE_ID: FileId = 0;

/** The file table of a single-file program. */
export const singleFile = (path: string): readonly ProgramFile[] => [{ id: SINGLE_FILE_ID, path }];

/** A source range in the user's original source (1-based lines, 0-based columns). */
export interface SourceRange {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export type LocRole = "statement" | "condition" | "loop" | "call" | "return" | "expression";

export interface LocInfo extends SourceRange {
  /** The file this range is in. */
  readonly file: FileId;
  readonly role: LocRole;
  /** Names of variables read by this source construct (static analysis, best effort). */
  readonly reads: readonly string[];
}

export type BindingKind =
  | "var"
  | "let"
  | "const"
  | "param"
  | "function"
  | "class"
  | "catch"
  | "global";

export interface BindingInfo {
  readonly name: string;
  readonly kind: BindingKind;
  readonly line: number;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly range: SourceRange | null;
  /** The project file the diagnostic is in; absent for single-file programs. */
  readonly path?: string;
  /** Stable machine-readable code, e.g. `unsupported-async`, `syntax`. */
  readonly code: string;
}

export interface ProgramInfo {
  readonly languageId: string;
  /** The source files, indexed by {@link FileId}. */
  readonly files: readonly ProgramFile[];
  readonly locs: readonly LocInfo[];
  readonly bindings: readonly BindingInfo[];
  /** Non-fatal diagnostics (constructs that are executed but only partially traced). */
  readonly warnings: readonly Diagnostic[];
  /** Compile-time complexity estimate, when the language provides one. */
  readonly complexity: StaticComplexity | null;
}

export const pointRange = (line: number, column: number): SourceRange => ({
  line,
  column,
  endLine: line,
  endColumn: column + 1,
});
