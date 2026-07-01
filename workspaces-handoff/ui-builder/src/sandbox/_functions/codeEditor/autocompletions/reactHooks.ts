export function ReactHooksImporter(monaco: typeof import("monaco-editor")) {
  const reactHooks = [
    "useState",
    "useEffect",
    "useMemo",
    "useCallback",
    "useContext",
    "useRef"
  ];

  const completion = monaco.languages.registerCompletionItemProvider("typescript", {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      );
      const suggestions = reactHooks.map((hook) => ({
        label: hook,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: hook,
        range, // Monaco will replace the current word
        command: {
          id: "insertReactImport",
          title: "Add React Import",
          arguments: [hook, model] // pass hook name and model
        }
      }));
      return { suggestions };
    }
  });

  monaco.editor.registerCommand("insertReactImport", (_, ...args) => {
    const [hook, model] = args;
    const lines = model.getLinesContent();

    // Check if a React import already exists
    const importLineIndex = lines.findIndex((line: string[]) => line.includes('from "react"'));
    if (importLineIndex >= 0) {
      const line = lines[importLineIndex];
      if (!line.includes(hook)) {
        // Add hook to existing import
        let newLine = "";
        if (line.includes("{")) {
          newLine = line.replace('{', `{ ${hook},`);
        } else {
          newLine = line.replace(' from', `, { ${hook} } from`);
        }
        model.applyEdits([{
          range: new monaco.Range(importLineIndex + 1, 1, importLineIndex + 1, line.length + 1),
          text: newLine
        }]);
      }
    } else {
      // Insert new import at top
      model.applyEdits([{
        range: new monaco.Range(1, 1, 1, 1),
        text: `import { ${hook} } from "react";\n`
      }]);
    }
  });

  return completion;
}