//? Shared pointer-resize state for vertically resizable panels. Each remembered key keeps its own
//? height so unrelated panels retain the independent defaults they had before this hook was extracted.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const rememberedHeights = new Map<string, number>();

export function useRememberedPanelHeight(key: string, initialHeight: number, minHeight = 220, maxHeight = 900): {
  height: number;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
} {
  const [height, setHeight] = useState(() => rememberedHeights.get(key) ?? initialHeight);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startY: event.clientY, startH: height };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const next = Math.min(maxHeight, Math.max(minHeight, dragRef.current.startH + (event.clientY - dragRef.current.startY)));
    rememberedHeights.set(key, next);
    setHeight(next);
  };
  const onPointerUp = () => { dragRef.current = null; setDragging(false); };

  return { height, dragging, onPointerDown, onPointerMove, onPointerUp };
}
