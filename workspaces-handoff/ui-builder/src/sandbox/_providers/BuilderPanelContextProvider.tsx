import { createContext, useContext, useState, ReactNode, RefObject, SetStateAction, Dispatch, useRef, useEffect } from 'react';

export enum BuilderMenuMode {
  CODE = "CODE",
  BUILDER = "BUILDER",
  CLOSED = "CLOSED"
}

type BuilderPanelContextType = {
  builderMenuMode: BuilderMenuMode;
  setBuilderMenuMode: Dispatch<SetStateAction<BuilderMenuMode>>;
  
  prevBuilderMenuMode: BuilderMenuMode;
  setPrevBuilderMenuMode: Dispatch<SetStateAction<BuilderMenuMode>>;

  windowDividerDragging: RefObject<boolean>;

  windowDivider: boolean;
  setWindowDivider: Dispatch<SetStateAction<boolean>>;

  windowDividerPosition: number | null;
  setWindowDividerPosition: Dispatch<SetStateAction<number | null>>;

  lastPositionWindowDivider: RefObject<number>;
};

const BuilderPanelContext = createContext<BuilderPanelContextType | undefined>(undefined);

export const BuilderPanelProvider = ({ children }: { children: ReactNode }) => {
  const [builderMenuMode, setBuilderMenuMode] = useState<BuilderMenuMode>(BuilderMenuMode.CLOSED);
  const [prevBuilderMenuMode, setPrevBuilderMenuMode] = useState<BuilderMenuMode>(BuilderMenuMode.CODE);

  const windowDividerDragging: RefObject<boolean> = useRef(false);
  const [windowDivider, setWindowDivider] = useState<boolean>(false);
  const [windowDividerPosition, setWindowDividerPosition] = useState<number | null>(null);
  const lastPositionWindowDivider = useRef<number>(0);

  useEffect(() => {
    if (builderMenuMode == BuilderMenuMode.CLOSED) { return; }
    setPrevBuilderMenuMode(builderMenuMode);
  }, [builderMenuMode])

  return (
    <BuilderPanelContext.Provider value={{ 
      builderMenuMode, 
      setBuilderMenuMode,

      prevBuilderMenuMode, 
      setPrevBuilderMenuMode,
      
      windowDividerPosition,
      setWindowDividerPosition,

      windowDividerDragging,
      
      windowDivider,
      setWindowDivider,

      lastPositionWindowDivider,
    }}>
      {children}
    </BuilderPanelContext.Provider>
  );
};

export const useBuilderPanel = () => {
  const context = useContext(BuilderPanelContext);
  if (!context) {
    throw new Error('useMenuState must be used within a MenuStateProvider');
  }
  return context;
};