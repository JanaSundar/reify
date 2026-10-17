import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import type { LanguageServiceClient } from "@/engine/core/protocol/languageService";

/** Typing these keeps the current completion list valid, so the editor filters locally. */
const IDENTIFIER = /^[\w$]*$/;

const hoverDom = (text: string, documentation: string | undefined): HTMLElement => {
  const dom = document.createElement("div");
  const signature = dom.appendChild(document.createElement("div"));
  signature.className = "cm-hover-signature";
  signature.textContent = text;
  if (documentation) {
    const docs = dom.appendChild(document.createElement("div"));
    docs.className = "cm-hover-docs";
    docs.textContent = documentation;
  }
  return dom;
};

/**
 * Language-neutral editor intelligence: keeps the service's copy of the document in sync
 * and serves completions and hover info from it. Diagnostics are pulled by the editor's
 * lint source (which merges them with the app's own), not here.
 */
export const languageServiceExtension = (client: LanguageServiceClient | null): Extension => {
  if (!client) return autocompletion();
  return [
    EditorView.updateListener.of((update) => {
      if (update.docChanged) client.update(update.state.doc.toString());
    }),
    autocompletion({
      override: [
        async (context: CompletionContext) => {
          const result = await client.complete(context.pos, context.explicit);
          if (!result || context.aborted) return null;
          return { from: result.from, options: [...result.options], validFor: IDENTIFIER };
        },
      ],
    }),
    hoverTooltip(async (_view, pos) => {
      const info = await client.hover(pos);
      if (!info) return null;
      return {
        pos: info.from,
        end: info.to,
        above: true,
        create: () => ({ dom: hoverDom(info.text, info.documentation) }),
      };
    }),
  ];
};
