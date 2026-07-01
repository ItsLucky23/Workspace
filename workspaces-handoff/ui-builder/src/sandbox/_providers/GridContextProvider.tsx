import { createContext, useContext, useState, ReactNode, RefObject, SetStateAction, Dispatch, useRef, useCallback } from 'react';

export type ScrollMode = 'zoom' | 'pan';

type GridContextType = {
  containerRef: RefObject<HTMLDivElement | null>;
  draggingRef: RefObject<boolean>;
  lastPos: RefObject<{ x: number; y: number }>;
  posMouseDown: RefObject<{ x: number; y: number }>;
  zoomRef: RefObject<number>;

  dragging: boolean;
  setDragging: Dispatch<SetStateAction<boolean>>;

  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;

  offset: { x: number; y: number };
  setOffset: Dispatch<SetStateAction<{ x: number; y: number }>>;

  scrollMode: ScrollMode;
  setScrollMode: Dispatch<SetStateAction<ScrollMode>>;

  isTransitioning: boolean;
  resetToCenter: () => void;
};

const GridContext = createContext<GridContextType | undefined>(undefined);

export const GridProvider = ({ children }: { children: ReactNode }) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [scrollMode, setScrollMode] = useState<ScrollMode>('zoom');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const posMouseDown = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);

  // Keep zoomRef in sync with zoom state
  zoomRef.current = zoom;

  // Reset view to center with smooth transition
  const resetToCenter = useCallback(() => {
    setIsTransitioning(true);
    setOffset({ x: 0, y: 0 });
    setZoom(1);

    // Remove transition class after animation completes
    setTimeout(() => {
      setIsTransitioning(false);
    }, 500);
  }, []);

  return (
    <GridContext.Provider value={{
      containerRef,
      draggingRef,
      lastPos,
      posMouseDown,
      zoomRef,

      dragging,
      setDragging,

      zoom,
      setZoom,

      offset,
      setOffset,

      scrollMode,
      setScrollMode,

      isTransitioning,
      resetToCenter,
    }}>
      {children}
    </GridContext.Provider>
  );
};

export const useGrid = () => {
  const context = useContext(GridContext);
  if (!context) {
    throw new Error('useGrid must be used within a GridProvider');
  }
  return context;
};