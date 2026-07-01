import InitAutoSuggestion from "./autoSuggestion";
import * as monaco from "monaco-editor";
import { tailwindcssColors } from "./color";
import InitInlineColorIcon from "./inlineColorIcon";

export default function InitTailwindcss(monacoInstance: typeof import("monaco-editor"), editorInstance: monaco.editor.IStandaloneCodeEditor) {

  const autoSuggestionsHandler = InitAutoSuggestion(monacoInstance, extractColorValue);
  const inlineColorIcons = InitInlineColorIcon(editorInstance, extractColorValue);
  
  return () => {
    autoSuggestionsHandler.dispose();
    inlineColorIcons.dispose();
  }
} 

function extractColorValue(className: string): string | null {
  const match = className.match(/(?:text|decoration|bg|divide|outline|ring|shadow|accent|caret|fill|stroke|border|border-t|border-b|border-l|border-r|border-x|border-y)-([a-z]+-\d{1,3})/);
  if (!match) return null;
  const base = match[1];
  return tailwindcssColors[base as keyof typeof tailwindcssColors] || null;
}