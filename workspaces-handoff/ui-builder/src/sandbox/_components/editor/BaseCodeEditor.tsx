import { useEffect, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import setCompilerOptions from "../../_functions/codeEditor/compilerOptions";
import loadAutoCompletions from "../../_functions/codeEditor/autocompletions/autocompletionHandler";
import traverseClickedComponent from "../../_functions/codeEditor/traverseClickedComponent";
import HoverTooltip from "src/sandbox/_functions/codeEditor/hoverTooltip";
import InitTailwindcss from "src/sandbox/_functions/codeEditor/tailwindcss/tailwindcss";
import generateThemes from "src/sandbox/_functions/codeEditor/themes/themes";

type BaseCodeEditorProps = {
  value: string;
  onChange: (value: string | undefined) => void;
  language?: string;
  theme?: string;
  options?: monacoEditor.editor.IStandaloneEditorConstructionOptions;
  path?: string;
  onMount?: (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => void;
  onHeightUpdateStart?: () => void;
  onHeightUpdateEnd?: () => void;
}

export default function BaseCodeEditor({
  value,
  onChange,
  language = "typescript",
  theme = "vs-dark",
  options,
  path = "file:///App.tsx",
  onMount
}: BaseCodeEditorProps) {
  const monacoInstance = useMonaco();
  const [editor, setEditor] = useState<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

  const userComponents = [
    { name: "Dropdown", code: "export function Dropdown() { return <div>...</div> }" },
    { name: "MyButton", code: "export function MyButton() { return <button>Click</button> }" }
  ];

  // Determine if we should use the custom theme (only for TS/JS)
  const isTypeScriptOrJavaScript = ['typescript', 'javascript', 'tsx', 'jsx'].includes(language);
  const editorTheme = isTypeScriptOrJavaScript ? "trae-dark" : "vs-dark";

  useEffect(() => {
    if (!monacoInstance) return;

    setCompilerOptions(monacoInstance);
    generateThemes(monacoInstance);

    if (isTypeScriptOrJavaScript) {
      monacoInstance.editor.setTheme("trae-dark");
    } else {
      monacoInstance.editor.setTheme("vs-dark");
    }

    const disposeAutoCompletions = loadAutoCompletions(monacoInstance);
    return () => {
      disposeAutoCompletions();
    };
  }, [monacoInstance, isTypeScriptOrJavaScript]);

  useEffect(() => {
    if (!editor) { return; }

    HoverTooltip(editor);

    traverseClickedComponent({
      editor,
      userComponents
    });
  }, [editor]);

  useEffect(() => {
    if (!monacoInstance || !editor) { return; }

    const disposTailwind = InitTailwindcss(monacoInstance, editor);
    return () => {
      disposTailwind();
    }
  }, [monacoInstance, editor]);

  const [height, setHeight] = useState<string | number>("100%");

  return (
    <div className="flex flex-col w-full" style={{ height }}>
      <Editor
        height="100%"
        width="100%"
        language={language}
        path={path}
        value={value}
        theme={editorTheme}
        onMount={(editor, monaco) => {
          setEditor(editor);
          if (monaco) {
            monaco.editor.setTheme(editorTheme);
          }
          if (onMount) onMount(editor, monaco);

          if (options?.scrollBeyondLastLine === false) {
            const MAX_HEIGHT = 700; // Match the maxHeight in CodeBlockComponent

            const updateHeight = () => {
              const contentHeight = editor.getContentHeight();
              // Cap at max height to prevent updates beyond CSS maxHeight
              const cappedHeight = Math.min(contentHeight, MAX_HEIGHT);
              setHeight(cappedHeight);
            };

            editor.onDidContentSizeChange(updateHeight);
            updateHeight(); // Initial size
          }
        }}
        onChange={onChange}
        options={{
          fontSize: 16,
          minimap: { enabled: false },
          automaticLayout: true,
          autoClosingBrackets: "always",
          tabCompletion: "on",
          "semanticHighlighting.enabled": true,
          ...options
        }}
      />
    </div>
  );
}
