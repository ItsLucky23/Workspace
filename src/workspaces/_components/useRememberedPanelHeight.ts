//? Shared pointer-resize state for resizable panels. Each remembered key keeps its own size so
//? unrelated panels retain the independent defaults they had before this hook was extracted.
//? `axis: 'height'` grows with a downward drag (bottom-edge handle); `axis: 'width'` is for a
//? panel anchored to the RIGHT whose left edge is the handle, so dragging LEFT widens it.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const rememberedSizes = new Map<string, number>();

export function useRememberedPanelSize(key: string, initialSize: number, minSize = 220, maxSize = 900, axis: 'height' | 'width' = 'height'): {
  size: number;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
} {
  const [size, setSize] = useState(() => rememberedSizes.get(key) ?? initialSize);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ start: number; startSize: number } | null>(null);
  const coord = (event: ReactPointerEvent<HTMLDivElement>): number => (axis === 'height' ? event.clientY : event.clientX);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { start: coord(event), startSize: size };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = coord(event) - dragRef.current.start;
    const next = Math.min(maxSize, Math.max(minSize, dragRef.current.startSize + (axis === 'height' ? delta : -delta)));
    rememberedSizes.set(key, next);
    setSize(next);
  };
  const onPointerUp = () => { dragRef.current = null; setDragging(false); };

  return { size, dragging, onPointerDown, onPointerMove, onPointerUp };
}

//? The original vertical call shape, kept so the existing terminal panels stay untouched.
export function useRememberedPanelHeight(key: string, initialHeight: number, minHeight = 220, maxHeight = 900): {
  height: number;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
} {
  const { size, ...rest } = useRememberedPanelSize(key, initialHeight, minHeight, maxHeight, 'height');
  return { height: size, ...rest };
}
