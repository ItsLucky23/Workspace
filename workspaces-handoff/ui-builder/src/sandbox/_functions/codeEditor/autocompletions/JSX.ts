export function HTMLTagCloser(monaco: typeof import("monaco-editor")) {
  return monaco.languages.registerCompletionItemProvider("typescript", {
    triggerCharacters: [">"],
    provideCompletionItems: (model, position) => {
      const lineContent = model.getLineContent(position.lineNumber);
      const tagEndIndex = lineContent.indexOf(">");
      const trimmedLineContext = lineContent.trim();

      if (trimmedLineContext.startsWith("<") && !trimmedLineContext.startsWith("</") && trimmedLineContext.endsWith(">")) {
        const tagName = trimmedLineContext
          .slice(
            1,
            trimmedLineContext.indexOf(" ") > -1
              ? trimmedLineContext.indexOf(" ")
              : trimmedLineContext.indexOf(">")
          )
          .replace(/\/?>$/, "");

        const insertTextClassname = ` className={`+"`$0`"+`}>\n  \n</${tagName}>`;

        return {
          suggestions: [
            {
              label: `Close with className <${tagName}>`,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: insertTextClassname,
              range: new monaco.Range(
                position.lineNumber,
                tagEndIndex + 1,
                position.lineNumber,
                tagEndIndex + 2
              ),
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            },
            {
              label: `Close <${tagName}>`,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: `$0</${tagName}>`,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            },
          ],
        };
      }
      return { suggestions: [] };
    },
  })
}