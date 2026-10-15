import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { gutter, GutterMarker, type EditorView } from "@codemirror/view";

/** Replaces the breakpoint lines shown in the gutter (1-based). */
export const setBreakpoints = StateEffect.define<readonly number[]>();

class BreakpointMarker extends GutterMarker {
  override toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-breakpoint-marker";
    dot.setAttribute("aria-label", "Breakpoint");
    return dot;
  }
}
const marker = new BreakpointMarker();

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, transaction) {
    let next = set.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setBreakpoints)) continue;
      const doc = transaction.state.doc;
      next = RangeSet.of(
        effect.value
          .filter((line) => line >= 1 && line <= doc.lines)
          .map((line) => marker.range(doc.line(line).from)),
        true,
      );
    }
    return next;
  },
});

/**
 * A clickable gutter: clicking a line number area toggles a breakpoint. The lines are owned
 * by the caller (`onToggle`) and pushed back in with {@link setBreakpoints}.
 */
export const breakpointGutter = (onToggle: (line: number) => void): Extension => [
  breakpointField,
  gutter({
    class: "cm-breakpoints",
    markers: (view) => view.state.field(breakpointField),
    initialSpacer: () => marker,
    domEventHandlers: {
      mousedown(view: EditorView, block) {
        onToggle(view.state.doc.lineAt(block.from).number);
        return true;
      },
    },
  }),
];
