import { pointRange, type Diagnostic } from "../../../core/protocol/program";
import { babelTransform, type BabelTypes } from "./babel";

/** Options every Babel call here shares: never read the host's configuration. */
export const BABEL_OPTIONS = {
  configFile: false,
  babelrc: false,
  browserslistConfigFile: false,
} as const;

interface BabelSyntaxError {
  readonly message: string;
  readonly loc?: { readonly line: number; readonly column: number };
}

/** Converts a Babel parse error into a diagnostic without Babel's code frame noise. */
export const syntaxDiagnostic = (error: unknown, fileName: string): Diagnostic => {
  const { message, loc } = error as BabelSyntaxError;
  const firstLine = (message ?? String(error)).split("\n")[0] ?? "";
  // Babel prefixes the (possibly path-qualified) file name and suffixes `(line:column)`.
  const prefix = firstLine.indexOf(`${fileName}: `);
  const clean = (prefix >= 0 ? firstLine.slice(prefix + fileName.length + 2) : firstLine).replace(
    /\s*\(\d+:\d+\)$/,
    "",
  );
  return {
    severity: "error",
    code: "syntax",
    message: clean,
    range: loc ? pointRange(loc.line, loc.column) : null,
  };
};

export const internalDiagnostic = (error: unknown): Diagnostic => ({
  severity: "error",
  code: "internal",
  message: `Instrumentation failed: ${error instanceof Error ? error.message : String(error)}`,
  range: null,
});

export interface ParseOptions {
  readonly fileName: string;
  readonly typescript: boolean;
  /** `script` for a single-file program, `module` for a file of a project. */
  readonly sourceType: "script" | "module";
}

export type ParseResult =
  | { readonly ok: true; readonly ast: BabelTypes.File }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** Parses source (stripping TypeScript types), keeping original locations on every node. */
export const parseSource = (source: string, options: ParseOptions): ParseResult => {
  let ast: BabelTypes.File | null | undefined;
  try {
    ast = babelTransform(source, {
      ...BABEL_OPTIONS,
      sourceType: options.sourceType,
      filename: options.fileName,
      presets: options.typescript ? [["typescript", { onlyRemoveTypeImports: true }]] : [],
      ast: true,
      code: false,
    })?.ast;
  } catch (error) {
    return { ok: false, diagnostic: syntaxDiagnostic(error, options.fileName) };
  }
  if (!ast) return { ok: false, diagnostic: internalDiagnostic("no AST produced") };
  return { ok: true, ast };
};
