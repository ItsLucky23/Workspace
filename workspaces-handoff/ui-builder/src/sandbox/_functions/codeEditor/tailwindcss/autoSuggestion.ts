import * as monaco from "monaco-editor";
import { isInsideClassName } from "./classDetector";
import { tailwindcssClasses } from "./classes";

export default function InitAutoSuggestion(
  monacoInstance: typeof monaco,
  extractColorValue: (className: string) => string | null = () => null
) {
  return monacoInstance.languages.registerCompletionItemProvider("typescript", {
    triggerCharacters: ['"', "'", "`", " ", "-"],
    provideCompletionItems: (model, position) => {
      const line = model.getLineContent(position.lineNumber);
      const text = line.substring(0, position.column - 1);

      if (!isInsideClassName(text)) {
        return { suggestions: [] };
      }
      const range = getClassFragmentRange(model, position);

      const suggestions = tailwindcssClasses.map(cls => {
        const color = extractColorValue(cls);

        const shade = cls.split("-").pop()!;
        const sortText = shade.padStart(3, "0"); // 50 -> "050", 400 -> "400"

        return {
          label: cls,
          kind: color
            ? monacoInstance.languages.CompletionItemKind.Color
            : monacoInstance.languages.CompletionItemKind.Keyword,
          insertText: cls,
          documentation: color
            ? {
                value: `Color preview: ${color}`,
              }
            : undefined,
          //? The range of text to replace
          range: range,
          sortText
        };
      });

      return { suggestions };
    },
  });
}

function getClassFragmentRange(model: monaco.editor.ITextModel, position: monaco.Position) {
  const line = model.getLineContent(position.lineNumber);
  const before = line.substring(0, position.column - 1);
  const match = before.match(/[\w:-]+$/);

  const startColumn = match
    ? before.length - match[0].length + 1
    : position.column;

  return new monaco.Range(
    position.lineNumber,
    startColumn,
    position.lineNumber,
    position.column
  );
}