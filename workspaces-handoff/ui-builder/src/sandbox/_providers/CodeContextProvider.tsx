import { createContext, useContext, useState, ReactNode, SetStateAction, Dispatch, useEffect } from 'react';
import { codeContext } from '../types/blueprints';
import * as monaco from 'monaco-editor';

type CodeContextType = {
  codeWindows: codeContext[];
  setCodeWindows: Dispatch<SetStateAction<codeContext[]>>;

  activeCodeWindow: string | null;
  setActiveCodeWindow: Dispatch<SetStateAction<string | null>>;

  codeWindowSize: number;
  setCodeWindowSize: Dispatch<SetStateAction<number>>;

  currentMonacoInstance: typeof monaco | null;
  setCurrentMonacoInstance: Dispatch<SetStateAction<typeof monaco | null>>;

  currentEditorInstance: monaco.editor.IStandaloneCodeEditor | null;
  setCurrentEditorInstance: Dispatch<SetStateAction<monaco.editor.IStandaloneCodeEditor | null>>;
};

const CodeContext = createContext<CodeContextType | undefined>(undefined);

export const CodeProvider = ({ children }: { children: ReactNode }) => {
  const [codeWindows, setCodeWindows] = useState<codeContext[]>([]);
  const [activeCodeWindow, setActiveCodeWindow] = useState<string | null>(null);
  const [codeWindowSize, setCodeWindowSize] = useState<number>(16);
  const [currentMonacoInstance, setCurrentMonacoInstance] = useState<typeof monaco | null>(null);
  const [currentEditorInstance, setCurrentEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    let size = codeWindowSize;
    if (codeWindowSize < 6) {
      setCodeWindowSize(6);
      size = 6;
    } else if (codeWindowSize > 100) {
      setCodeWindowSize(100);
      size = 100;
    }
    currentEditorInstance?.updateOptions({ fontSize: size });
  }, [codeWindowSize])

  return (
    <CodeContext.Provider value={{ 
      codeWindows, 
      setCodeWindows,

      activeCodeWindow,
      setActiveCodeWindow,

      codeWindowSize,
      setCodeWindowSize,

      currentMonacoInstance,
      setCurrentMonacoInstance,

      currentEditorInstance,
      setCurrentEditorInstance
    }}>
      {children}
    </CodeContext.Provider>
  );
};

export const useCode = () => {
  const context = useContext(CodeContext);
  if (!context) {
    throw new Error('useCode must be used within a CodeProvider');
  }
  return context;
};