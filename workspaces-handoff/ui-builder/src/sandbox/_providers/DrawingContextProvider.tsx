import { createContext, useContext, useState, ReactNode, SetStateAction, Dispatch, useEffect } from 'react';

export type DrawingPoint = {
  x: number;
  y: number;
  color: string;
  size: number;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export type StrokeData = {
  id: string;
  points: DrawingPoint[];
  fill?: string;
  text?: string;
  width?: number; // For text bounds
  height?: number; // For text bounds
  lineStyle?: LineStyle; // Line style: solid, dashed, or dotted
}

export enum ErasingMode {
  DISABLED,
  PARTIAL,
  FULL
}

export type ShapeType = 'square' | 'circle' | 'diamond' | 'line' | 'arrow';

type DrawingContextType = {
  strokes: StrokeData[];
  setStrokes: Dispatch<SetStateAction<StrokeData[]>>;

  currentPoints: DrawingPoint[];
  setCurrentPoints: Dispatch<SetStateAction<DrawingPoint[]>>;

  brushSize: number;
  setBrushSize: Dispatch<SetStateAction<number>>;

  brushColor: string;
  setBrushColor: Dispatch<SetStateAction<string>>;

  drawingEnabled: boolean;
  setDrawingEnabled: Dispatch<SetStateAction<boolean>>;

  showDrawings: boolean;
  setShowDrawings: Dispatch<SetStateAction<boolean>>;

  erasing: ErasingMode;
  setErasing: Dispatch<SetStateAction<ErasingMode>>;

  activeShape: ShapeType | null;
  setActiveShape: Dispatch<SetStateAction<ShapeType | null>>;

  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;

  selectedStrokeIds: string[];
  setSelectedStrokeIds: Dispatch<SetStateAction<string[]>>;

  // Feature Toggles
  showMeasurements: boolean;
  setShowMeasurements: Dispatch<SetStateAction<boolean>>;

  snappingEnabled: boolean;
  setSnappingEnabled: Dispatch<SetStateAction<boolean>>;

  marqueeMode: boolean;
  setMarqueeMode: Dispatch<SetStateAction<boolean>>;
  marqueeBox: { x: number, y: number, width: number, height: number } | null;
  setMarqueeBox: Dispatch<SetStateAction<{ x: number, y: number, width: number, height: number } | null>>;

  fillMode: boolean;
  setFillMode: Dispatch<SetStateAction<boolean>>;

  textMode: boolean;
  setTextMode: Dispatch<SetStateAction<boolean>>;

  strokeHistory: StrokeData[][]
  setStrokeHistory: Dispatch<SetStateAction<StrokeData[][]>>
  historyIndex: number
  setHistoryIndex: Dispatch<SetStateAction<number>>

  lineStyle: LineStyle;
  setLineStyle: Dispatch<SetStateAction<LineStyle>>;

  updateBrushColor: (color: string) => void;
  updateBrushSize: (size: number) => void;
};

const DrawingContext = createContext<DrawingContextType | undefined>(undefined);

export const DrawingProvider = ({ children }: { children: ReactNode }) => {
  const [strokes, setStrokes] = useState<StrokeData[]>([])
  const [currentPoints, setCurrentPoints] = useState<DrawingPoint[]>([])
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [showDrawings, setShowDrawings] = useState(true);

  const [strokeHistory, setStrokeHistory] = useState<StrokeData[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  //? tools in the drawing menu when drawing is enabled
  const [brushSize, setBrushSize] = useState<number>(10)
  const [brushColor, setBrushColor] = useState<string>('#FFFFFF')
  const [erasing, setErasing] = useState<ErasingMode>(ErasingMode.DISABLED);
  const [activeShape, setActiveShape] = useState<ShapeType | null>(null);

  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);

  const [showMeasurements, setShowMeasurements] = useState<boolean>(false);
  const [snappingEnabled, setSnappingEnabled] = useState<boolean>(true); // Default to true as per request "fix when moving around objects like figma"

  const [marqueeMode, setMarqueeMode] = useState<boolean>(false);
  const [marqueeBox, setMarqueeBox] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [fillMode, setFillMode] = useState<boolean>(false);
  const [textMode, setTextMode] = useState<boolean>(false);
  const [lineStyle, setLineStyle] = useState<LineStyle>('solid');

  // Sync strokes to history when historyIndex changes (for undo/redo)
  useEffect(() => {
    if (strokeHistory.length > 0 && historyIndex >= 0 && historyIndex < strokeHistory.length) {
      setStrokes(strokeHistory[historyIndex]);
    }
  }, [historyIndex, strokeHistory]);

  // Clamp historyIndex to valid range
  useEffect(() => {
    if (historyIndex >= strokeHistory.length && strokeHistory.length > 0) {
      setHistoryIndex(strokeHistory.length - 1);
    }
  }, [historyIndex, strokeHistory.length]);

  // Clear selection when switching away from marquee mode
  useEffect(() => {
    if (!marqueeMode) {
      setMarqueeBox(null);
    }
  }, [marqueeMode]);

  useEffect(() => {
    if (erasing !== ErasingMode.DISABLED && brushSize < 60) {
      setBrushSize(Math.min(300, brushSize * 6))
    } else if (erasing === ErasingMode.DISABLED) {
      setBrushSize(Math.max(10, brushSize / 6))
    }
  }, [erasing])

  return (
    <DrawingContext.Provider value={{
      strokes,
      setStrokes,

      currentPoints,
      setCurrentPoints,

      brushSize,
      setBrushSize,

      brushColor,
      setBrushColor,

      drawingEnabled,
      setDrawingEnabled,

      showDrawings,
      setShowDrawings,

      erasing,
      setErasing,

      activeShape,
      setActiveShape,

      selectionMode,
      setSelectionMode,

      selectedStrokeIds,
      setSelectedStrokeIds,

      showMeasurements,
      setShowMeasurements,

      snappingEnabled,
      setSnappingEnabled,

      marqueeMode,
      setMarqueeMode,
      marqueeBox,
      setMarqueeBox,

      fillMode,
      setFillMode,
      textMode,
      setTextMode,
      strokeHistory,
      setStrokeHistory,
      historyIndex,
      setHistoryIndex,
      lineStyle,
      setLineStyle,

      // Helper to update color (handling selection logic)
      updateBrushColor: (color: string) => {
        setBrushColor(color);
        if (selectedStrokeIds.length > 0) {
          const newStrokes = strokes.map(s => {
            if (selectedStrokeIds.includes(s.id)) {
              return {
                ...s,
                // If the shape has a fill, update it to match the new color
                fill: s.fill ? color : undefined,
                points: s.points.map(p => ({ ...p, color }))
              };
            }
            return s;
          });
          setStrokes(newStrokes);
          setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
          setHistoryIndex(prev => prev + 1);
        } else if (selectionMode) {
          // If in selection mode but nothing selected, switch to drawing (disable selection mode)
          setSelectionMode(false);
        }
        if (erasing) setErasing(ErasingMode.DISABLED);
      },

      updateBrushSize: (size: number) => {
        setBrushSize(size);
        if (selectedStrokeIds.length > 0) {
          const newStrokes = strokes.map(s => {
            if (selectedStrokeIds.includes(s.id)) {
              return {
                ...s,
                points: s.points.map(p => ({ ...p, size }))
              };
            }
            return s;
          });
          setStrokes(newStrokes);
          setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
          setHistoryIndex(prev => prev + 1);
        }
      }
    }}>
      {children}
    </DrawingContext.Provider>
  );
};

export const useDrawing = () => {
  const context = useContext(DrawingContext);
  if (!context) {
    throw new Error('useDrawing must be used within a DrawingProvider');
  }
  return context;
};
