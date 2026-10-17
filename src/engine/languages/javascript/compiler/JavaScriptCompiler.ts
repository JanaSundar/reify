import { estimateStatic } from "../../../core/analysis/staticEstimate";
import type { CompileResult } from "../../../core/protocol/messages";
import { pointRange, singleFile, type Diagnostic } from "../../../core/protocol/program";
import type { LanguageCompiler } from "../../types";
import { babelTransform, babelTransformFromAst, type BabelTypes, type PluginObject } from "./babel";
import { normalizeVisitor, unsupportedVisitor } from "./checks";
import { complexityShape } from "./complexity";
import { Instrumenter } from "./instrument";
import { BindingTable, DiagnosticLog, LocTable } from "./tables";

const COMMON_OPTIONS = {
  sourceType: "script",
  configFile: false,
  babelrc: false,
  browserslistConfigFile: false,
} as const;

interface BabelSyntaxError {
  readonly message: string;
  readonly loc?: { readonly line: number; readonly column: number };
}

/** Converts a Babel parse error into a diagnostic without Babel's code frame noise. */
const syntaxDiagnostic = (error: unknown, fileName: string): Diagnostic => {
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

const internalDiagnostic = (error: unknown): Diagnostic => ({
  severity: "error",
  code: "internal",
  message: `Instrumentation failed: ${error instanceof Error ? error.message : String(error)}`,
  range: null,
});

/**
 * Compiles JavaScript or TypeScript into instrumented JavaScript.
 *
 * Two passes: (1) parse and strip types, keeping original source locations on every node;
 * (2) check for unsupported constructs, normalize and instrument.
 */
export class JavaScriptCompiler implements LanguageCompiler {
  private readonly fileName: string;

  constructor(
    readonly languageId: string,
    private readonly typescript: boolean,
  ) {
    this.fileName = typescript ? "main.ts" : "main.js";
  }

  compile(source: string): CompileResult {
    let ast: BabelTypes.File | null | undefined;
    try {
      ast = babelTransform(source, {
        ...COMMON_OPTIONS,
        filename: this.fileName,
        presets: this.typescript ? [["typescript", { onlyRemoveTypeImports: true }]] : [],
        ast: true,
        code: false,
      })?.ast;
    } catch (error) {
      return { ok: false, diagnostics: [syntaxDiagnostic(error, this.fileName)] };
    }
    if (!ast) return { ok: false, diagnostics: [internalDiagnostic("no AST produced")] };

    // Analyse the type-stripped original before instrumentation rewrites it.
    const complexity = estimateStatic(complexityShape(ast.program, source));
    const locs = new LocTable();
    const bindings = new BindingTable();
    const log = new DiagnosticLog();

    let code: string | null | undefined;
    try {
      code = babelTransformFromAst(ast, source, {
        ...COMMON_OPTIONS,
        filename: this.fileName,
        plugins: [() => instrumentationPlugin(locs, bindings, log)],
        comments: false,
        code: true,
        ast: false,
      })?.code;
    } catch (error) {
      return { ok: false, diagnostics: [internalDiagnostic(error)] };
    }

    if (log.errors.length > 0) return { ok: false, diagnostics: log.errors };
    if (code == null) return { ok: false, diagnostics: [internalDiagnostic("no code produced")] };

    return {
      ok: true,
      code,
      program: {
        languageId: this.languageId,
        files: singleFile(this.fileName),
        locs: locs.locs,
        bindings: bindings.bindings,
        warnings: log.warnings,
        complexity,
      },
    };
  }
}

const instrumentationPlugin = (
  locs: LocTable,
  bindings: BindingTable,
  log: DiagnosticLog,
): PluginObject => ({
  visitor: {
    Program(path) {
      path.traverse(unsupportedVisitor(log));
      if (log.errors.length > 0) {
        path.stop();
        return;
      }
      path.traverse(normalizeVisitor);
      path.scope.crawl();
      const instrumenter = new Instrumenter(locs, bindings, log);
      path.traverse(instrumenter.visitor);
      instrumenter.finishProgram(path);
      path.stop();
    },
  },
});
