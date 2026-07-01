import * as monacoEditor from "monaco-editor";

export default function HoverTooltip(editor: monacoEditor.editor.IStandaloneCodeEditor) {
  editor?.updateOptions({
    hover: {
      above: false //? yes just having this value set to false makes it apprear below or above the line whereever there is more space
    },
  })
}