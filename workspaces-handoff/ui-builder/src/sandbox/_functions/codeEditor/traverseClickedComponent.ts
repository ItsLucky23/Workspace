import * as monaco from "monaco-editor";

export default function traverseClickedComponent({
  editor,
  userComponents
}: {
  editor: monaco.editor.IStandaloneCodeEditor,
  userComponents: { name: string; code: string }[]
}) {

  editor.onMouseDown(e => {
    const { target, event } = e;

    if (!event.ctrlKey || event.buttons == 0) return;
    const matched = userComponents.find(c => c.name == target.element?.innerText);
    if (matched) {
      console.log("Ctrl + clicked component:", matched.name);
      event.preventDefault();
    }
  });
}