import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface ExecutionMark {
  readonly line: number;
  readonly endLine: number;
  /** Calls are styled differently from ordinary statements. */
  readonly kind: "statement" | "call";
}

export const setExecutionMark = StateEffect.define<ExecutionMark | null>();

const statementLine = Decoration.line({ class: "cm-exec-line" });
const callLine = Decoration.line({ class: "cm-exec-line-call" });

const clampLine = (doc: Text, line: number): number => Math.min(Math.max(1, line), doc.lines);

const decorate = (doc: Text, mark: ExecutionMark): DecorationSet => {
  const decoration = mark.kind === "call" ? callLine : statementLine;
  const first = clampLine(doc, mark.line);
  const last = clampLine(doc, Math.max(mark.line, mark.endLine));
  const ranges = [];
  for (let line = first; line <= last; line++) ranges.push(decoration.range(doc.line(line).from));
  return Decoration.set(ranges);
};

/** Highlights the original source lines of the current step; maps through edits. */
const executionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setExecutionMark)) {
        next = effect.value ? decorate(transaction.state.doc, effect.value) : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const executionLine = (): Extension => executionField;

/** Effects that move the highlight and keep it in view without stealing focus. */
export const executionMarkEffects = (
  view: EditorView,
  mark: ExecutionMark | null,
): StateEffect<unknown>[] => {
  const effects: StateEffect<unknown>[] = [setExecutionMark.of(mark)];
  if (mark) {
    const line = view.state.doc.line(clampLine(view.state.doc, mark.line));
    effects.push(EditorView.scrollIntoView(line.from, { y: "nearest", yMargin: 48 }));
  }
  return effects;
};
