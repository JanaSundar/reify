"use client";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript, javascriptLanguage, scopeCompletionSource } from "@codemirror/lang-javascript";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { Compartment, EditorState, type Text } from "@codemirror/state";
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
import { syntaxColors } from "./highlight";
import { executionLine, executionMarkEffects, type ExecutionMark } from "./executionLine";

export interface EditorDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly range: SourceRange | null;
}

interface CodeEditorProps {
  readonly initialValue: string;
  readonly typescript: boolean;
  readonly execution: ExecutionMark | null;
  readonly diagnostics: readonly EditorDiagnostic[];
  readonly onChange: (value: string) => void;
  readonly onRun: () => void;
  readonly onCancel: () => boolean;
}

/** Builtins offered by autocomplete in addition to local identifiers and keywords. */
const COMPLETION_SCOPE = { Math, Array, Object, Map, Set, Number, String, JSON, console, Infinity };

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
  typescript,
  execution,
  diagnostics,
  onChange,
  onRun,
  onCancel,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const callbacks = useRef({ onChange, onRun, onCancel });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onRun, onCancel };
  });

  useEffect(() => {
    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        syntaxColors(),
        language.current.of(javascript({ typescript })),
        javascriptLanguage.data.of({ autocomplete: scopeCompletionSource(COMPLETION_SCOPE) }),
        autocompletion(),
        lintGutter(),
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
    view.current?.dispatch({ effects: language.current.reconfigure(javascript({ typescript })) });
  }, [typescript]);

  useEffect(() => {
    const editor = view.current;
    if (editor) editor.dispatch({ effects: executionMarkEffects(editor, execution) });
  }, [execution]);

  useEffect(() => {
    const editor = view.current;
    if (editor)
      editor.dispatch(setDiagnostics(editor.state, toCmDiagnostics(editor.state.doc, diagnostics)));
  }, [diagnostics]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
