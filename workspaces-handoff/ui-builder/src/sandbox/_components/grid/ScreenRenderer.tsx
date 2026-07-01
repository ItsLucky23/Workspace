import React, { useEffect, useMemo, useState } from "react";
import { compileTSX, loadModule } from "../../_functions/codeEditor/babel/compiler";
import { ErrorBoundary } from "./ErrorBoundary";

interface ScreenRendererProps {
  code: string;
  id: string;
  name: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const ScreenRenderer = ({ code, className, style, onClick }: ScreenRendererProps) => {
  const [debouncedCode, setDebouncedCode] = useState(code);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCode(code);
    }, 1000);

    return () => clearTimeout(timer);
  }, [code]);

  const Component = useMemo(() => {
    const compiled = compileTSX(debouncedCode);
    return loadModule(compiled) as React.ComponentType;
  }, [debouncedCode]);

  return (
    <div
      style={style}
      className={`@container ${className ?? ''}`}
      onClick={onClick}
    >
      <ErrorBoundary resetKey={debouncedCode}>
        <Component />
      </ErrorBoundary>
    </div>
  );
};
