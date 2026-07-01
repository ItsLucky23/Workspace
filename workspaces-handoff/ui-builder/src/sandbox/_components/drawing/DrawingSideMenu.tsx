import { useDrawing } from "src/sandbox/_providers/DrawingContextProvider";
import { HexColorPicker } from "react-colorful";
import { useEffect, useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPalette, faRedo, faUndo } from "@fortawesome/free-solid-svg-icons";
import { useKeyboardShortcuts } from "src/sandbox/_functions/drawing/useKeyboardShortcuts";

export default function DrawingSideMenu() {
  useKeyboardShortcuts();

  const {
    drawingEnabled,

    brushSize,

    brushColor,

    erasing,

    setHistoryIndex,
    strokeHistory,
    updateBrushColor,
    updateBrushSize,
    lineStyle,
    setLineStyle,
    strokes,
    setStrokes,
    selectedStrokeIds,
    setStrokeHistory,
    historyIndex
  } = useDrawing();

  // Helper to update line style (also updates selected strokes)
  const updateLineStyle = (style: 'solid' | 'dashed' | 'dotted') => {
    setLineStyle(style);
    if (selectedStrokeIds.length > 0) {
      const newStrokes = strokes.map(s => {
        if (selectedStrokeIds.includes(s.id)) {
          return { ...s, lineStyle: style };
        }
        return s;
      });
      setStrokes(newStrokes);
      setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
      setHistoryIndex(prev => prev + 1);
    }
  };

  const [openColorPicker, setOpenColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setOpenColorPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [])

  // if (!drawingEnabled) { return null }

  const colors = [
    "#ef4444", // Red
    "#ffba00", // Amber
    "#05df72", // Green
    "#22d3ee", // Cyan
    "#a855f7", // Purple
    "#ec4899", // Pink
  ];

  return (
    <div
      className={`
        absolute left-4 top-1/2 -translate-y-1/2 z-50 
        flex flex-col gap-3 p-3 w-36
        bg-background2 border border-border2 rounded-lg text-text select-none
        transition-all duration-200 origin-left
        ${drawingEnabled ? 'opacity-100 scale-100' : 'opacity-0 scale-80'}
      `}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onDragStart={(e) => e.preventDefault()}
    >

      <div className="">
        <div className="flex justify-between items-center text-sm">
          <span>Size</span>
          {/* <span>{brushSize}px</span> */}
        </div>
        <div className="flex justify-between mt-1">
          <div
            className={`font-semibold w-8 h-8 rounded flex items-center justify-center bg-background border ${brushSize === (erasing ? 10 * 6 : 10) ? 'border-primary' : 'border-transparent hover:border-border cursor-pointer'}`}
            onClick={() => { updateBrushSize(erasing ? 10 * 6 : 10) }}
          >S</div>
          <div
            className={`font-semibold w-8 h-8 rounded flex items-center justify-center bg-background border ${brushSize === (erasing ? 30 * 6 : 30) ? 'border-primary' : 'border-transparent hover:border-border cursor-pointer'}`}
            onClick={() => { updateBrushSize(erasing ? 30 * 6 : 30) }}
          >M</div>
          <div
            className={`font-semibold w-8 h-8 rounded flex items-center justify-center bg-background border ${brushSize === (erasing ? 50 * 6 : 50) ? 'border-primary' : 'border-transparent hover:border-border cursor-pointer'}`}
            onClick={() => { updateBrushSize(erasing ? 50 * 6 : 50) }}
          >L</div>
        </div>
      </div>

      {/* Line Style */}
      <div className="">
        <span className="text-sm text-text-secondary">Style</span>
        <div className="flex justify-between mt-1">
          <div
            className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer bg-background border ${lineStyle === 'solid' ? 'border-primary' : 'border-transparent hover:border-border'}`}
            onClick={() => updateLineStyle('solid')}
            title="Solid"
          >
            <svg width="16" height="2" viewBox="0 0 16 2">
              <line x1="0" y1="1" x2="16" y2="1" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div
            className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer bg-background border ${lineStyle === 'dashed' ? 'border-primary' : 'border-transparent hover:border-border'}`}
            onClick={() => updateLineStyle('dashed')}
            title="Dashed"
          >
            <svg width="16" height="2" viewBox="0 0 16 2">
              <line x1="0" y1="1" x2="16" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
            </svg>
          </div>
          <div
            className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer bg-background border ${lineStyle === 'dotted' ? 'border-primary' : 'border-transparent hover:border-border'}`}
            onClick={() => updateLineStyle('dotted')}
            title="Dotted"
          >
            <svg width="16" height="2" viewBox="0 0 16 2">
              <line x1="0" y1="1" x2="16" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="1 3" />
            </svg>
          </div>
        </div>
      </div>

      {/* Colors */}
      <div className="">
        <span className="text-sm text-text-secondary">Color</span>
        <div className="grid grid-cols-3 gap-2">
          {colors.map(color => (
            <button
              key={color}
              className={`w-full aspect-square rounded-md border transition-transform hover:scale-105 cursor-pointer ${brushColor === color ? '' : 'border-transparent'}`}
              style={{ backgroundColor: color }}
              onClick={() => {
                updateBrushColor(color);
              }}
            />
          ))}
        </div>
      </div>

      <div className="">
        {/* Custom Color Picker */}
        <div className="relative" ref={colorPickerRef}>
          <button
            className="w-full flex items-center p-2 bg-background border border-transparent hover:border-border rounded-md text-sm text-text-secondary transition-colors"
            onClick={() => setOpenColorPicker(!openColorPicker)}
          >
            <FontAwesomeIcon icon={faPalette} size="lg" />
            <div
              className="w-16 h-4 rounded-xl ml-auto"
              style={{ backgroundColor: brushColor }}
            />
          </button>

          {openColorPicker && (
            <div className="absolute top-full left-0 mt-2 z-50 shadow-xl rounded-lg overflow-hidden">
              <HexColorPicker color={brushColor} onChange={(c) => {
                updateBrushColor(c);
              }} />
            </div>
          )}
        </div>
      </div>

      {/* Undo / Redo */}
      <div className="flex gap-2">
        <button
          className="flex-1 flex items-center justify-center py-2 bg-background border border-transparent hover:border-border rounded-md transition-all"
          onClick={() => setHistoryIndex(prev => Math.max(0, prev - 1))}
          disabled={strokeHistory.length === 0} // Simple check, logic might need refinement based on index
        >
          <FontAwesomeIcon icon={faUndo} size="sm" />
        </button>
        <button
          className="flex-1 flex items-center justify-center py-2 bg-background border border-transparent hover:border-border rounded-md transition-all"
          onClick={() => setHistoryIndex(prev => Math.min(prev + 1, strokeHistory.length))}
        >
          <FontAwesomeIcon icon={faRedo} size="sm" />
        </button>
      </div>

    </div>
  )
}
