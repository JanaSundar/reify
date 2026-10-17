import { estimateStatic } from "../../../core/analysis/staticEstimate";
import type { CompileResult } from "../../../core/protocol/messages";
import { singleFile } from "../../../core/protocol/program";
import type { LanguageCompiler } from "../../types";
import { babelTransformFromAst, type PluginObject } from "./babel";
import { normalizeVisitor, unsupportedVisitor } from "./checks";
import { complexityShape } from "./complexity";
import { Instrumenter } from "./instrument";
import { BABEL_OPTIONS, internalDiagnostic, parseSource } from "./parse";
import { BindingTable, DiagnosticLog, LocTable } from "./tables";

const COMMON_OPTIONS = { ...BABEL_OPTIONS, sourceType: "script" } as const;

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
    const parsed = parseSource(source, {
      fileName: this.fileName,
      typescript: this.typescript,
      sourceType: "script",
    });
    if (!parsed.ok) return { ok: false, diagnostics: [parsed.diagnostic] };
    const { ast } = parsed;

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
