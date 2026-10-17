import type { Diagnostic } from "./program";

/**
 * Editor intelligence, independent of language. A language provides a `LanguageService`
 * (runs in a worker, owns the parsed program); the editor only ever sees this interface,
 * through an asynchronous client. Positions are character offsets into the source.
 */

export interface Completion {
  readonly label: string;
  /** CodeMirror completion type: `function`, `method`, `property`, `variable`, `keyword`... */
  readonly type: string;
  /** Short qualifier shown after the label (a signature or kind). */
  readonly detail?: string;
}

export interface CompletionResult {
  /** Start of the identifier being completed; options replace `from..pos`. */
  readonly from: number;
  readonly options: readonly Completion[];
}

export interface HoverInfo {
  readonly from: number;
  readonly to: number;
  /** The symbol's signature or type. */
  readonly text: string;
  readonly documentation?: string;
}

export interface LanguageService {
  /** Replaces the service's copy of the document. */
  update(source: string): void;
  /** Syntax errors, and type errors where the language has types. */
  diagnostics(): readonly Diagnostic[];
  complete(pos: number, explicit: boolean): CompletionResult | null;
  hover(pos: number): HoverInfo | null;
}

/** The same service seen from the other side of a worker boundary. */
export interface LanguageServiceClient {
  /** Resolves once the service has loaded; calls before then answer empty. */
  readonly ready: Promise<void>;
  update(source: string): void;
  diagnostics(): Promise<readonly Diagnostic[]>;
  complete(pos: number, explicit: boolean): Promise<CompletionResult | null>;
  hover(pos: number): Promise<HoverInfo | null>;
}
