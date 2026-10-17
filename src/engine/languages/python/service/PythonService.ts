import type { PyodideAPI } from "pyodide";
import type {
  CompletionResult,
  HoverInfo,
  LanguageService,
} from "../../../core/protocol/languageService";
import type { Diagnostic } from "../../../core/protocol/program";
import { installInstrumenter } from "../compiler/PythonCompiler";
import { installPythonModule } from "../pyodide";
import SERVICE from "./reify_service.py?raw";

/**
 * Python completions, hover text and syntax errors from CPython's own parser, inside Pyodide
 * (see `reify_service.py`). Reads the program; never runs it.
 */
export class PythonService implements LanguageService {
  private source = "";

  private constructor(
    private readonly diagnosticsJson: (source: string) => string,
    private readonly completeJson: (source: string, offset: number, explicit: boolean) => string,
    private readonly hoverJson: (source: string, offset: number) => string,
  ) {}

  /** Installs the service into a loaded Pyodide (passed in, so tests can use Node's). */
  static create(pyodide: PyodideAPI): PythonService {
    installInstrumenter(pyodide);
    const functions = installPythonModule(pyodide, "reify_service", SERVICE);
    return new PythonService(
      functions.diagnostics_json as (source: string) => string,
      functions.complete_json as (source: string, offset: number, explicit: boolean) => string,
      functions.hover_json as (source: string, offset: number) => string,
    );
  }

  update(source: string): void {
    this.source = source;
  }

  diagnostics(): readonly Diagnostic[] {
    return JSON.parse(this.diagnosticsJson(this.source)) as Diagnostic[];
  }

  complete(pos: number, explicit: boolean): CompletionResult | null {
    return JSON.parse(this.completeJson(this.source, pos, explicit)) as CompletionResult | null;
  }

  hover(pos: number): HoverInfo | null {
    return JSON.parse(this.hoverJson(this.source, pos)) as HoverInfo | null;
  }
}
