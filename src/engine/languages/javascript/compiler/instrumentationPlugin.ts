import type { Diagnostic } from "../../../core/protocol/program";
import { babelTransformFromAst, t, type BabelTypes, type PluginObject } from "./babel";
import { normalizeVisitor, unsupportedVisitor } from "./checks";
import { Instrumenter } from "./instrument";
import { BABEL_OPTIONS, internalDiagnostic } from "./parse";
import type { BindingTable, DiagnosticLog, LocTable } from "./tables";

interface PluginOptions {
  /** The file is an ES module of a project: static imports and exports are allowed. */
  readonly modules?: boolean;
  /** Statements placed first in the program, after instrumentation (generated, untraced). */
  readonly prologue?: readonly BabelTypes.Statement[];
}

/** Checks, normalizes and instruments a program; errors are reported through `log`. */
const instrumentationPlugin = (
  locs: LocTable,
  bindings: BindingTable,
  log: DiagnosticLog,
  options: PluginOptions = {},
): PluginObject => ({
  visitor: {
    Program(path) {
      path.traverse(unsupportedVisitor(log, options.modules));
      if (log.errors.length > 0) {
        path.stop();
        return;
      }
      path.traverse(normalizeVisitor);
      path.scope.crawl();
      const instrumenter = new Instrumenter(locs, bindings, log);
      path.traverse(instrumenter.visitor);
      instrumenter.finishProgram(path);
      if (options.prologue)
        path.node.body = [
          ...options.prologue.map((s) => t.cloneNode(s, true, true)),
          ...path.node.body,
        ];
      path.stop();
    },
  },
});

export interface InstrumentInput {
  readonly ast: BabelTypes.File;
  readonly source: string;
  readonly fileName: string;
  readonly locs: LocTable;
  readonly bindings: BindingTable;
  readonly log: DiagnosticLog;
  readonly options?: PluginOptions;
}

export type InstrumentResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Runs the instrumentation over a parsed program and generates the instrumented code. */
export const instrumentProgram = (input: InstrumentInput): InstrumentResult => {
  const { ast, source, fileName, locs, bindings, log, options } = input;
  let code: string | null | undefined;
  try {
    code = babelTransformFromAst(ast, source, {
      ...BABEL_OPTIONS,
      sourceType: options?.modules ? "module" : "script",
      filename: fileName,
      plugins: [() => instrumentationPlugin(locs, bindings, log, options)],
      comments: false,
      code: true,
      ast: false,
    })?.code;
  } catch (error) {
    return { ok: false, diagnostics: [internalDiagnostic(error)] };
  }
  if (log.errors.length > 0) return { ok: false, diagnostics: log.errors };
  if (code == null) return { ok: false, diagnostics: [internalDiagnostic("no code produced")] };
  return { ok: true, code };
};
