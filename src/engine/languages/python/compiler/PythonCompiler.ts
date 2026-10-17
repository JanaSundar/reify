import type { PyodideAPI } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { estimateStatic, type CostShape } from "../../../core/analysis/staticEstimate";
import type { CompileResult } from "../../../core/protocol/messages";
import type { LanguageCompiler } from "../../types";
import { installPythonModule, installReifyProtocol } from "../pyodide";
import COMPLEXITY from "./reify_complexity.py?raw";
import EXPRESSIONS from "./reify_expressions.py?raw";
import INSTRUMENTER from "./reify_instrument.py?raw";
import STATEMENTS from "./reify_statements.py?raw";
import TABLES from "./reify_tables.py?raw";

/** The instrumenter's support modules, in import order (each imports only earlier ones). */
const SUPPORT_MODULES = [
  ["reify_tables", TABLES],
  ["reify_expressions", EXPRESSIONS],
  ["reify_statements", STATEMENTS],
  ["reify_complexity", COMPLEXITY],
] as const;

/** `compile_json`'s result: a `CompileResult` whose program carries the complexity shape. */
type PythonCompileResult =
  | Extract<CompileResult, { ok: false }>
  | (Omit<Extract<CompileResult, { ok: true }>, "program"> & {
      readonly program: Omit<Extract<CompileResult, { ok: true }>["program"], "complexity"> & {
        readonly complexity: CostShape | null;
      };
    });

/**
 * Installs the instrumenter and its support modules into a loaded Pyodide and returns the
 * `reify_instrument` module. Safe to call twice: the editor's language service imports it too.
 */
export const installInstrumenter = (pyodide: PyodideAPI): PyProxy => {
  installReifyProtocol(pyodide);
  for (const [name, source] of SUPPORT_MODULES) installPythonModule(pyodide, name, source);
  return installPythonModule(pyodide, "reify_instrument", INSTRUMENTER);
};

const internalFailure = (message: string): CompileResult => ({
  ok: false,
  diagnostics: [{ severity: "error", code: "internal", message, range: null }],
});

/**
 * Compiles Python with CPython's own parser, inside Pyodide: diagnostics, location and
 * binding tables, a static complexity estimate, and instrumented source (see
 * `reify_instrument.py`). Never runs user code.
 */
export class PythonCompiler implements LanguageCompiler {
  private constructor(
    readonly languageId: string,
    private readonly compileJson: (source: string) => string,
  ) {}

  /** Installs the instrumenter into a loaded Pyodide (passed in, so tests can use Node's). */
  static create(languageId: string, pyodide: PyodideAPI): PythonCompiler {
    const instrumenter = installInstrumenter(pyodide);
    const compileJson = instrumenter.compile_json as (source: string) => string;
    return new PythonCompiler(languageId, compileJson);
  }

  compile(source: string): CompileResult {
    let json: string;
    try {
      json = this.compileJson(source);
    } catch (error) {
      return internalFailure(`The Python compiler crashed: ${String(error)}`);
    }
    const result = JSON.parse(json) as PythonCompileResult;
    if (typeof result !== "object" || result === null || typeof result.ok !== "boolean")
      return internalFailure("The Python compiler returned an unexpected result.");
    if (!result.ok) return result;
    const { complexity } = result.program;
    return {
      ...result,
      program: { ...result.program, complexity: complexity ? estimateStatic(complexity) : null },
    };
  }
}
