import { estimateStatic } from "../../../core/analysis/staticEstimate";
import type { CompileResult } from "../../../core/protocol/messages";
import { singleFile } from "../../../core/protocol/program";
import type { LanguageCompiler } from "../../types";
import { complexityShape } from "./complexity";
import { instrumentProgram } from "./instrumentationPlugin";
import { parseSource } from "./parse";
import { BindingTable, DiagnosticLog, LocTable } from "./tables";

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

    const instrumented = instrumentProgram({
      ast,
      source,
      fileName: this.fileName,
      locs,
      bindings,
      log,
    });
    if (!instrumented.ok) return instrumented;
    const { code } = instrumented;

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
