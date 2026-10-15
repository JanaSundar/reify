import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

/** Syntax colors from the design tokens, so light and dark themes both stay readable. */
const style = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.moduleKeyword],
    color: "var(--val-keyword)",
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--val-number)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--val-string)" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--faint)",
    fontStyle: "italic",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--val-type)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--accent)",
  },
  { tag: tags.definition(tags.variableName), color: "var(--text)", fontWeight: "500" },
  { tag: [tags.propertyName, tags.variableName], color: "var(--text)" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--muted)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

export const syntaxColors = (): Extension => syntaxHighlighting(style);
