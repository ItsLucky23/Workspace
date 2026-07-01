import * as monaco from "monaco-editor";
import { HTMLTagCloser } from "./JSX";
import { ReactHooksImporter } from "./reactHooks";

export default function loadAutoCompletions(monaco: typeof import("monaco-editor")) {

  const autoCompletions: monaco.IDisposable[] = []

  autoCompletions.push(HTMLTagCloser(monaco));
  autoCompletions.push(ReactHooksImporter(monaco));

  // Clean up on dispose
  return () => {
    autoCompletions.forEach((disposable) => disposable.dispose());
  };
}