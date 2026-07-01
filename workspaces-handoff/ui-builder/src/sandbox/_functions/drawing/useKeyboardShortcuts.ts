import { useEffect, useRef } from "react";
import { useDrawing, StrokeData } from "src/sandbox/_providers/DrawingContextProvider";
import { useGrid } from "src/sandbox/_providers/GridContextProvider";

export function useKeyboardShortcuts() {
  const {
    setHistoryIndex,
    historyIndex,
    strokeHistory,
    setStrokes,
    selectedStrokeIds,
    setSelectedStrokeIds,
    setStrokeHistory,
    strokes,
    drawingEnabled
  } = useDrawing();

  const { zoom } = useGrid();

  const mousePosRef = useRef<{ x: number; y: number } | null>(null);

  // Track mouse position for paste offset
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (drawingEnabled) {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [drawingEnabled]);

  useEffect(() => {
    if (!drawingEnabled) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Don't interfere with text input
      const activeEl = document.activeElement;
      const isTyping = activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement;

      // Undo: Ctrl + Z (only if not typing - let browser handle native undo in text fields)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isTyping) {
        e.preventDefault();
        setHistoryIndex(prev => {
          const newIndex = Math.max(0, prev - 1);
          return newIndex;
        });
      }

      // Redo: Ctrl + Y or Ctrl + Shift + Z (only if not typing)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isTyping) {
        e.preventDefault();
        setHistoryIndex(prev => {
          const newIndex = Math.min(strokeHistory.length - 1, prev + 1);
          return newIndex;
        });
      }

      // Delete: Delete or Backspace (only if not typing)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
        if (selectedStrokeIds.length > 0) {
          e.preventDefault();
          // Delete selected strokes
          const newStrokes = strokes.filter(s => !selectedStrokeIds.includes(s.id));
          setStrokes(newStrokes);
          setSelectedStrokeIds([]);

          // Add to history
          setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
          setHistoryIndex(prev => prev + 1);
        }
      }

      // Copy: Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isTyping) {
        const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
        if (selected.length > 0) {
          const json = JSON.stringify(selected);
          try {
            await navigator.clipboard.writeText(json);
            console.log("Copied strokes to clipboard");
          } catch (err) {
            console.error("Failed to copy:", err);
          }
        }
      }

      // Cut: Ctrl+X
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !isTyping) {
        const selected = strokes.filter(s => selectedStrokeIds.includes(s.id));
        if (selected.length > 0) {
          const json = JSON.stringify(selected);
          try {
            await navigator.clipboard.writeText(json);
            // Delete
            const newStrokes = strokes.filter(s => !selectedStrokeIds.includes(s.id));
            setStrokes(newStrokes);
            setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
            setHistoryIndex(prev => prev + 1);
            setSelectedStrokeIds([]);
          } catch (err) {
            console.error("Failed to cut:", err);
          }
        }
      }

      // Paste: Ctrl+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isTyping) {
        try {
          const text = await navigator.clipboard.readText();
          if (!text) return;

          let pastedData: StrokeData[];
          try {
            pastedData = JSON.parse(text);
          } catch { return; } // Not stroke data

          if (!Array.isArray(pastedData)) return;

          // Validate structure loosely
          const valid = pastedData.every(s => s.points && Array.isArray(s.points));
          if (!valid) return;

          // Offset and ID regen
          // Use mouse position if available, otherwise offset slightly
          let offsetX = 20 / zoom;
          let offsetY = 20 / zoom;

          if (mousePosRef.current) {
            // Calculate center of pasted strokes
            let minX = Infinity, minY = Infinity;
            for (const s of pastedData) {
              for (const p of s.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
              }
            }
            if (minX !== Infinity) {
              offsetX = mousePosRef.current.x - minX;
              offsetY = mousePosRef.current.y - minY;
            }
          }

          const newIds: string[] = [];

          const newStrokesToAdd = pastedData.map(s => {
            const newId = crypto.randomUUID();
            newIds.push(newId);
            return {
              ...s,
              id: newId,
              points: s.points.map(p => ({
                ...p,
                x: p.x + offsetX,
                y: p.y + offsetY
              }))
            }
          });

          const newStrokes = [...strokes, ...newStrokesToAdd];
          setStrokes(newStrokes);
          setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
          setHistoryIndex(prev => prev + 1);
          setSelectedStrokeIds(newIds);

        } catch (err) {
          console.error("Failed to paste:", err);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawingEnabled, historyIndex, strokeHistory, selectedStrokeIds, strokes, zoom, setHistoryIndex, setStrokes, setSelectedStrokeIds, setStrokeHistory]);
}
