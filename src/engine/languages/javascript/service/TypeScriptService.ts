import type * as TS from "typescript";
import type {
  Completion,
  CompletionResult,
  HoverInfo,
  LanguageService,
} from "../../../core/protocol/languageService";
import type { Diagnostic } from "../../../core/protocol/program";
import type { TypeEnvironment } from "../typecheck/environment";

/** Most options offered at once; the editor filters them further as the user types. */
const MAX_COMPLETIONS = 80;
const IDENTIFIER_BEFORE = /[\w$]*$/;

/** TypeScript's `ScriptElementKind` mapped to a CodeMirror completion type. */
const COMPLETION_TYPES: Readonly<Record<string, string>> = {
  method: "method",
  function: "function",
  "local function": "function",
  constructor: "function",
  property: "property",
  getter: "property",
  setter: "property",
  var: "variable",
  let: "variable",
  const: "variable",
  "local var": "variable",
  parameter: "variable",
  alias: "variable",
  class: "class",
  "local class": "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  "enum member": "constant",
  module: "namespace",
  keyword: "keyword",
};

export const completionType = (kind: string): string => COMPLETION_TYPES[kind] ?? "text";

/**
 * TypeScript's language service behind the language-neutral `LanguageService` interface,
 * for one document (a `.ts` or `.js` file) of a shared type environment.
 */
export class TypeScriptService implements LanguageService {
  constructor(
    private readonly ts: typeof TS,
    private readonly env: TypeEnvironment,
    private readonly path: string,
  ) {}

  update(source: string): void {
    if (this.env.getSourceFile(this.path)) this.env.updateFile(this.path, source);
    else this.env.createFile(this.path, source);
  }

  diagnostics(): readonly Diagnostic[] {
    const file = this.env.getSourceFile(this.path);
    if (!file) return [];
    const { languageService } = this.env;
    return [
      ...languageService.getSyntacticDiagnostics(this.path),
      ...languageService.getSemanticDiagnostics(this.path),
    ].flatMap((d) => (d.start === undefined ? [] : [this.toDiagnostic(file, d)]));
  }

  complete(pos: number, explicit: boolean): CompletionResult | null {
    const file = this.env.getSourceFile(this.path);
    if (!file) return null;
    const before = file.text.slice(0, pos);
    const prefix = IDENTIFIER_BEFORE.exec(before)?.[0] ?? "";
    const afterDot = before.slice(0, before.length - prefix.length).endsWith(".");
    if (prefix === "" && !afterDot && !explicit) return null;
    const info = this.env.languageService.getCompletionsAtPosition(this.path, pos, {});
    if (!info) return null;
    const wanted = prefix.toLowerCase();
    const options: Completion[] = info.entries
      .filter((entry) => entry.name.toLowerCase().includes(wanted))
      .toSorted((a, b) => a.sortText.localeCompare(b.sortText) || a.name.localeCompare(b.name))
      .slice(0, MAX_COMPLETIONS)
      .map((entry) => ({
        label: entry.name,
        type: completionType(entry.kind),
        detail: entry.kind === "keyword" ? undefined : entry.kind,
      }));
    return options.length === 0 ? null : { from: pos - prefix.length, options };
  }

  hover(pos: number): HoverInfo | null {
    if (!this.env.getSourceFile(this.path)) return null;
    const info = this.env.languageService.getQuickInfoAtPosition(this.path, pos);
    if (!info) return null;
    const documentation = this.ts.displayPartsToString(info.documentation);
    return {
      from: info.textSpan.start,
      to: info.textSpan.start + info.textSpan.length,
      text: this.ts.displayPartsToString(info.displayParts),
      ...(documentation ? { documentation } : {}),
    };
  }

  private toDiagnostic(file: TS.SourceFile, d: TS.Diagnostic): Diagnostic {
    const start = d.start ?? 0;
    const from = file.getLineAndCharacterOfPosition(start);
    const to = file.getLineAndCharacterOfPosition(start + Math.max(d.length ?? 1, 1));
    return {
      severity: d.category === this.ts.DiagnosticCategory.Warning ? "warning" : "error",
      code: `ts${d.code}`,
      message: this.ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      range: {
        line: from.line + 1,
        column: from.character,
        endLine: to.line + 1,
        endColumn: to.character,
      },
    };
  }
}
