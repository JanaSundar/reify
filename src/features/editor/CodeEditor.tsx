"use client";

import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import {
  forceLinting,
  lintGutter,
  linter,
  type Diagnostic as CmDiagnostic,
} from "@codemirror/lint";
import { Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { SourceRange } from "@/engine/core/protocol/program";
import type { LanguageId } from "@/engine/languages/catalog";
import type { LanguageServiceClient } from "@/engine/core/protocol/languageService";
import { syntaxColors } from "./highlight";
import { breakpointGutter, setBreakpoints } from "./breakpoints";
import { executionLine, executionMarkEffects, type ExecutionMark } from "./executionLine";
import { languageServiceExtension } from "./languageServiceExtension";

export interface EditorDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly range: SourceRange | null;
}

interface CodeEditorProps {
  readonly initialValue: string;
  readonly languageId: LanguageId;
  readonly execution: ExecutionMark | null;
  readonly diagnostics: readonly EditorDiagnostic[];
  readonly breakpoints: readonly number[];
  readonly onToggleBreakpoint: (line: number) => void;
  readonly onChange: (value: string) => void;
  /** The language service for a language, or null when it has none. */
  readonly serviceFor: (languageId: LanguageId) => LanguageServiceClient | null;
  /** Reports how many errors the language service currently finds (0 without one). */
  readonly onServiceErrors: (count: number) => void;
  /** Longest document the editor accepts; edits that would exceed it are rejected. */
  readonly maxLength: number;
  readonly onLimit: () => void;
  readonly onRun: () => void;
  readonly onCancel: () => boolean;
}

/** Syntax support per language; completions come from the language service. */
const LANGUAGE_SUPPORT: Record<LanguageId, () => Extension> = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  // PEP 8 indents by four spaces; JavaScript keeps the editor default of two.
  python: () => [python(), indentUnit.of("    ")],
};

const positionOf = (doc: Text, line: number, column: number): number => {
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  return Math.min(target.from + Math.max(0, column), target.to);
};

const toCmDiagnostics = (doc: Text, diagnostics: readonly EditorDiagnostic[]): CmDiagnostic[] =>
  diagnostics.flatMap((d) => {
    if (!d.range) return [];
    const from = positionOf(doc, d.range.line, d.range.column);
    const to = Math.max(from, positionOf(doc, d.range.endLine, d.range.endColumn));
    return [
      {
        from,
        to: to === from ? Math.min(from + 1, doc.length) : to,
        severity: d.severity,
        message: d.message,
      },
    ];
  });

/**
 * CodeMirror 6 editor. Uncontrolled: the document lives in CodeMirror; props drive the
 * execution highlight and diagnostics through transactions (no re-creation of the view).
 */
export function CodeEditor({
  initialValue,
  languageId,
  execution,
  diagnostics,
  breakpoints,
  onToggleBreakpoint,
  onChange,
  serviceFor,
  onServiceErrors,
  maxLength,
  onLimit,
  onRun,
  onCancel,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const intelligence = useRef(new Compartment());
  const service = useRef<LanguageServiceClient | null>(null);
  const appliedLanguage = useRef(languageId);
  const callbacks = useRef({
    serviceFor,
    onChange,
    onServiceErrors,
    onLimit,
    onRun,
    onCancel,
    onToggleBreakpoint,
  });
  const external = useRef(diagnostics);
  useLayoutEffect(() => {
    callbacks.current = {
      serviceFor,
      onChange,
      onServiceErrors,
      onLimit,
      onRun,
      onCancel,
      onToggleBreakpoint,
    };
    external.current = diagnostics;
  });

  useEffect(() => {
    service.current = callbacks.current.serviceFor(languageId);
    service.current?.update(initialValue);
    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        // Deleting is always allowed; growing past the limit is refused (and reported).
        EditorState.changeFilter.of((tr) => {
          if (!tr.docChanged || tr.newDoc.length <= Math.max(maxLength, tr.startState.doc.length))
            return true;
          callbacks.current.onLimit();
          return false;
        }),
        breakpointGutter((line) => callbacks.current.onToggleBreakpoint(line)),
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        syntaxColors(),
        language.current.of(LANGUAGE_SUPPORT[languageId]()),
        intelligence.current.of(languageServiceExtension(service.current)),
        lintGutter(),
        // One source for everything the editor underlines: compile and runtime diagnostics
        // from props plus whatever the language service finds (syntax and type errors).
        linter(
          async (editorView) => {
            const { doc } = editorView.state;
            const fromProps = toCmDiagnostics(doc, external.current);
            const client = service.current;
            if (!client) {
              callbacks.current.onServiceErrors(0);
              return fromProps;
            }
            await client.ready;
            const found = await client.diagnostics();
            // The document moved on while the worker was busy; the next pass will catch up.
            if (editorView.state.doc !== doc) return fromProps;
            callbacks.current.onServiceErrors(found.filter((d) => d.severity === "error").length);
            return [...fromProps, ...toCmDiagnostics(doc, found)];
          },
          { delay: 400 },
        ),
        executionLine(),
        keymap.of([
          { key: "Mod-Enter", preventDefault: true, run: () => (callbacks.current.onRun(), true) },
          { key: "Escape", run: () => callbacks.current.onCancel() },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ "aria-label": "Code editor" }),
      ],
    });
    const editor = new EditorView({ state, parent: host.current! });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The view is created once; later prop changes are applied through transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    // The editor was created with this language; only a change needs reconfiguring.
    if (!editor || appliedLanguage.current === languageId) return;
    appliedLanguage.current = languageId;
    const client = callbacks.current.serviceFor(languageId);
    service.current = client;
    client?.update(editor.state.doc.toString());
    editor.dispatch({
      effects: [
        language.current.reconfigure(LANGUAGE_SUPPORT[languageId]()),
        intelligence.current.reconfigure(languageServiceExtension(client)),
      ],
    });
    forceLinting(editor);
  }, [languageId]);

  useEffect(() => {
    const editor = view.current;
    if (editor) editor.dispatch({ effects: executionMarkEffects(editor, execution) });
  }, [execution]);

  useEffect(() => {
    if (view.current) forceLinting(view.current);
  }, [diagnostics]);

  useEffect(() => {
    view.current?.dispatch({ effects: setBreakpoints.of(breakpoints) });
  }, [breakpoints]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
