import { useEffect } from "react";
import { useGrid } from "../../_providers/GridContextProvider";
import { useDrawing } from "../../_providers/DrawingContextProvider";
import { useBuilderPanel } from "../../_providers/BuilderPanelContextProvider";

export default function useOnMouseMove() {

  const { 
    draggingRef, 
    lastPos, 
    setOffset 
  } = useGrid();

  const { 
    lastPositionWindowDivider, 
    windowDividerDragging 
  } = useBuilderPanel();

  const handleMouseMove = (e: MouseEvent) => {
    if (!draggingRef.current) return;
    
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  useEffect(() => {
    const rightPanel = document.getElementById("rightPanel");
    if (!rightPanel) { return; }

    const leftPanel = document.getElementById("leftPanel");
    if (!leftPanel) { return; }

    const handleMouseMove = (e: MouseEvent) => {
      if (!windowDividerDragging.current) return;

      const dx = e.clientX - lastPositionWindowDivider.current;
      const containerWidth = window.innerWidth;
      const newPosition = ((lastPositionWindowDivider.current + dx) / containerWidth) * 100;

      lastPositionWindowDivider.current = e.clientX;

      rightPanel.style.width = `${100 - newPosition}%`;
      leftPanel.style.width = `${newPosition}%`;
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [])

  return { handleMouseMove };
}