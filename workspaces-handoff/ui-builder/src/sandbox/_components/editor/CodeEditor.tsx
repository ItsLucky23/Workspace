import { useMemo } from "react";
import { useCode } from "../../_providers/CodeContextProvider";
import { useBlueprints } from "../../_providers/BlueprintsContextProvider";
import BaseCodeEditor from "./BaseCodeEditor";

export default function CodeEditor() {
  const {
    activeCodeWindow,
    codeWindows,
    setCurrentEditorInstance,
    setCurrentMonacoInstance
  } = useCode();
  const { blueprints, setBlueprints } = useBlueprints();

  const { code, setCode, language } = useMemo(() => {
    // First, get the language from the code window (where we stored it)
    const activeWindow = codeWindows.find(cw => cw.id === activeCodeWindow);
    const windowLanguage = activeWindow?.language;

    // Find file in blueprints
    const fileItem = blueprints.files?.find(f => f.id === activeCodeWindow);

    if (!fileItem) {
      return {
        code: "",
        setCode: () => { },
        language: "typescript"
      };
    }

    // Determine language - prioritize code window language, then default to typescript
    const lang = windowLanguage || "typescript";

    return {
      code: fileItem.code,
      setCode: (newCode: string) => {
        setBlueprints(prev => ({
          ...prev,
          files: prev.files?.map(f => f.id === activeCodeWindow ? { ...f, code: newCode } : f) || prev.files
        }));
      },
      language: lang
    };
  }, [blueprints, setBlueprints, activeCodeWindow, codeWindows]);

  return (
    <BaseCodeEditor
      value={code}
      onChange={(val) => val && setCode(val)}
      path={`file:///App.${language === 'typescript' ? 'tsx' : language}`}
      language={language}
      onMount={(editor, monaco) => {
        setCurrentEditorInstance(editor);
        if (monaco) {
          setCurrentMonacoInstance(monaco);
        }
      }}
    />
  );
}

