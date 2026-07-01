import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useGrid } from 'src/sandbox/_providers/GridContextProvider';
import { useBlueprints } from 'src/sandbox/_providers/BlueprintsContextProvider';

const MINIMAP_WIDTH = 240;
const MINIMAP_HEIGHT = 160;

// Fixed sizes for indicators (in pixels)
const VIEWPORT_INDICATOR_WIDTH = 14;
const VIEWPORT_INDICATOR_HEIGHT = 10;
const ITEM_MIN_SIZE = 4;

// Edge scrolling settings
const EDGE_ZONE_PERCENT = 0.15; // 15% of each edge triggers scrolling
const EDGE_SCROLL_SPEED = 50; // World units per frame

export default function Minimap() {
  const { offset, setOffset, zoom, containerRef } = useGrid();
  const { blueprints } = useBlueprints();

  const minimapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const edgeScrollIntervalRef = useRef<number | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartScaleRef = useRef<number | null>(null);

  const getViewportSize = useCallback(() => {
    if (!containerRef.current) {
      return { width: 1920, height: 1080 };
    }
    return {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    };
  }, [containerRef]);

  const viewportCenter = useMemo(() => {
    const viewport = getViewportSize();
    return {
      x: (viewport.width / 2 - offset.x) / zoom,
      y: (viewport.height / 2 - offset.y) / zoom
    };
  }, [offset, zoom, getViewportSize]);

  const minimapSize = useMemo(() => {
    return { width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT };
  }, []);

  const worldBounds = useMemo(() => {
    const allItems = [...blueprints.files, ...blueprints.notes];

    let minX = -1500;
    let maxX = 1500;
    let minY = -1000;
    let maxY = 1000;

    minX = Math.min(minX, viewportCenter.x - 500);
    maxX = Math.max(maxX, viewportCenter.x + 500);
    minY = Math.min(minY, viewportCenter.y - 500);
    maxY = Math.max(maxY, viewportCenter.y + 500);

    for (const item of allItems) {
      const x = item.position.x;
      const y = item.position.y;
      const w = 'width' in item ? (item.width || 300) : 400;
      const h = 'height' in item ? (item.height || 200) : 300;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + w);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + h);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    return {
      minX: minX - width * 0.1,
      maxX: maxX + width * 0.1,
      minY: minY - height * 0.1,
      maxY: maxY + height * 0.1
    };
  }, [blueprints, viewportCenter]);

  const scale = useMemo(() => {
    if (isDragging && dragStartScaleRef.current !== null) {
      return dragStartScaleRef.current;
    }

    const worldWidth = worldBounds.maxX - worldBounds.minX;
    const worldHeight = worldBounds.maxY - worldBounds.minY;

    const scaleX = (minimapSize.width - 16) / worldWidth;
    const scaleY = (minimapSize.height - 16) / worldHeight;

    return Math.min(scaleX, scaleY);
  }, [worldBounds, minimapSize, isDragging]);

  const worldCenter = useMemo(() => ({
    x: (worldBounds.minX + worldBounds.maxX) / 2,
    y: (worldBounds.minY + worldBounds.maxY) / 2
  }), [worldBounds]);

  const worldToMinimap = useCallback((worldX: number, worldY: number) => {
    const minimapCenterX = minimapSize.width / 2;
    const minimapCenterY = minimapSize.height / 2;

    return {
      x: minimapCenterX + (worldX - worldCenter.x) * scale,
      y: minimapCenterY + (worldY - worldCenter.y) * scale
    };
  }, [minimapSize, worldCenter, scale]);

  const minimapToWorld = useCallback((minimapX: number, minimapY: number) => {
    const minimapCenterX = minimapSize.width / 2;
    const minimapCenterY = minimapSize.height / 2;

    return {
      x: worldCenter.x + (minimapX - minimapCenterX) / scale,
      y: worldCenter.y + (minimapY - minimapCenterY) / scale
    };
  }, [minimapSize, worldCenter, scale]);

  const minimapToOffset = useCallback((minimapX: number, minimapY: number) => {
    const viewport = getViewportSize();
    const worldPos = minimapToWorld(minimapX, minimapY);

    return {
      x: viewport.width / 2 - worldPos.x * zoom,
      y: viewport.height / 2 - worldPos.y * zoom
    };
  }, [minimapToWorld, getViewportSize, zoom]);

  const originPos = useMemo(() => worldToMinimap(0, 0), [worldToMinimap]);

  const viewportIndicator = useMemo(() => {
    const pos = worldToMinimap(viewportCenter.x, viewportCenter.y);
    return {
      x: pos.x - VIEWPORT_INDICATOR_WIDTH / 2,
      y: pos.y - VIEWPORT_INDICATOR_HEIGHT / 2,
      width: VIEWPORT_INDICATOR_WIDTH,
      height: VIEWPORT_INDICATOR_HEIGHT
    };
  }, [viewportCenter, worldToMinimap]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragStartScaleRef.current = scale;
    setIsDragging(true);

    const rect = minimapRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const newOffset = minimapToOffset(x, y);
      setOffset(newOffset);
    }
  }, [minimapToOffset, setOffset, scale]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const rect = minimapRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      lastMousePosRef.current = { x, y };

      const newOffset = minimapToOffset(x, y);
      setOffset(newOffset);
    }
  }, [isDragging, minimapToOffset, setOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartScaleRef.current = null;
    lastMousePosRef.current = null;

    if (edgeScrollIntervalRef.current) {
      clearInterval(edgeScrollIntervalRef.current);
      edgeScrollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isDragging) {
      if (edgeScrollIntervalRef.current) {
        clearInterval(edgeScrollIntervalRef.current);
        edgeScrollIntervalRef.current = null;
      }
      return;
    }

    const edgeScroll = () => {
      const mousePos = lastMousePosRef.current;
      if (!mousePos) return;

      const { x, y } = mousePos;
      const edgeX = minimapSize.width * EDGE_ZONE_PERCENT;
      const edgeY = minimapSize.height * EDGE_ZONE_PERCENT;

      let scrollX = 0;
      let scrollY = 0;

      if (x < edgeX) {
        scrollX = -EDGE_SCROLL_SPEED * (1 - x / edgeX);
      } else if (x > minimapSize.width - edgeX) {
        scrollX = EDGE_SCROLL_SPEED * (1 - (minimapSize.width - x) / edgeX);
      }

      if (y < edgeY) {
        scrollY = -EDGE_SCROLL_SPEED * (1 - y / edgeY);
      } else if (y > minimapSize.height - edgeY) {
        scrollY = EDGE_SCROLL_SPEED * (1 - (minimapSize.height - y) / edgeY);
      }

      if (scrollX !== 0 || scrollY !== 0) {
        setOffset(prev => ({
          x: prev.x - scrollX * zoom,
          y: prev.y - scrollY * zoom
        }));
      }
    };

    edgeScrollIntervalRef.current = window.setInterval(edgeScroll, 50);

    return () => {
      if (edgeScrollIntervalRef.current) {
        clearInterval(edgeScrollIntervalRef.current);
        edgeScrollIntervalRef.current = null;
      }
    };
  }, [isDragging, minimapSize, zoom, setOffset]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const hasItems = blueprints.files.length > 0 || blueprints.notes.length > 0;

  return (
    <div
      ref={minimapRef}
      className="MENU absolute bottom-4 right-4 z-50 bg-background2/90 border border-border2 rounded-lg overflow-hidden cursor-pointer backdrop-blur-sm"
      style={{
        width: minimapSize.width,
        height: minimapSize.height,
      }}
      onMouseDown={handleMouseDown}
    >
      {!hasItems && (
        <div className="absolute inset-0 flex items-center justify-center text-text/30 text-xs">
          No items
        </div>
      )}

      {originPos.x > 0 && originPos.x < minimapSize.width &&
        originPos.y > 0 && originPos.y < minimapSize.height && (
          <>
            <div
              className="absolute bg-red-500/60 pointer-events-none"
              style={{
                left: originPos.x - 5,
                top: originPos.y - 0.5,
                width: 10,
                height: 1,
              }}
            />
            <div
              className="absolute bg-red-500/60 pointer-events-none"
              style={{
                left: originPos.x - 0.5,
                top: originPos.y - 5,
                width: 1,
                height: 10,
              }}
            />
          </>
        )}

      {blueprints.files.map((file) => {
        const { x, y } = worldToMinimap(file.position.x, file.position.y);
        if (x < -10 || x > minimapSize.width + 10 || y < -10 || y > minimapSize.height + 10) {
          return null;
        }
        return (
          <div
            key={file.id}
            className="absolute bg-primary/70 rounded-sm pointer-events-none"
            style={{
              left: x - ITEM_MIN_SIZE / 2,
              top: y - ITEM_MIN_SIZE / 2,
              width: ITEM_MIN_SIZE,
              height: ITEM_MIN_SIZE,
            }}
          />
        );
      })}

      {blueprints.notes.map((note) => {
        const { x, y } = worldToMinimap(note.position.x, note.position.y);
        if (x < -10 || x > minimapSize.width + 10 || y < -10 || y > minimapSize.height + 10) {
          return null;
        }
        return (
          <div
            key={note.id}
            className="absolute bg-yellow-500/70 rounded-sm pointer-events-none"
            style={{
              left: x - ITEM_MIN_SIZE / 2,
              top: y - ITEM_MIN_SIZE / 2,
              width: ITEM_MIN_SIZE,
              height: ITEM_MIN_SIZE,
            }}
          />
        );
      })}

      <div
        className="absolute border-2 border-white/90 bg-white/20 rounded-sm pointer-events-none"
        style={{
          left: Math.max(2, Math.min(minimapSize.width - VIEWPORT_INDICATOR_WIDTH - 2, viewportIndicator.x)),
          top: Math.max(2, Math.min(minimapSize.height - VIEWPORT_INDICATOR_HEIGHT - 2, viewportIndicator.y)),
          width: viewportIndicator.width,
          height: viewportIndicator.height,
          boxShadow: '0 0 4px rgba(0,0,0,0.3)',
        }}
      />

      <div className="absolute bottom-1 left-1 text-[8px] text-text/50 pointer-events-none font-mono">
        {Math.round(viewportCenter.x)}, {Math.round(viewportCenter.y)}
      </div>
    </div>
  );
}
