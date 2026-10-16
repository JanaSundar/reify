import type { PyodideAPI } from "pyodide";
import type { CompileResult } from "../../../core/protocol/messages";
import type { LanguageCompiler } from "../../types";
import { installPythonModule } from "../pyodide";
import INSTRUMENTER from "./reify_instrument.py?raw";

const internalFailure = (message: string): CompileResult => ({
  ok: false,
  diagnostics: [{ severity: "error", code: "internal", message, range: null }],
});

/**
 * Compiles Python with CPython's own parser, inside Pyodide: diagnostics, location and
 * binding tables, and instrumented source (see `reify_instrument.py`). Never runs user code.
 */
export class PythonCompiler implements LanguageCompiler {
  private constructor(
    readonly languageId: string,
    private readonly compileJson: (source: string) => string,
  ) {}

  /** Installs the instrumenter into a loaded Pyodide (passed in, so tests can use Node's). */
  static create(languageId: string, pyodide: PyodideAPI): PythonCompiler {
    const instrumenter = installPythonModule(pyodide, "reify_instrument", INSTRUMENTER);
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
    const result = JSON.parse(json) as CompileResult;
    return typeof result === "object" && result !== null && typeof result.ok === "boolean"
      ? result
      : internalFailure("The Python compiler returned an unexpected result.");
  }
}
