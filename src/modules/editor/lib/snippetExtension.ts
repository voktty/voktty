import {
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { applySnippetIndent, snippetsForLanguage } from "./snippets";

export function editorSnippetExtension(
  getLanguage: () => string | null,
): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$-]*/);
    if (!word || (!context.explicit && word.from === word.to)) return null;
    const snippets = snippetsForLanguage(getLanguage());
    if (snippets.length === 0) return null;
    return {
      from: word.from,
      options: snippets.map((entry) =>
        snippetCompletion(
          applySnippetIndent(
            entry.template,
            context.state.facet(indentUnit) || "\t",
          ),
          {
            label: entry.prefix,
            type: "keyword",
          },
        ),
      ),
    };
  };

  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
