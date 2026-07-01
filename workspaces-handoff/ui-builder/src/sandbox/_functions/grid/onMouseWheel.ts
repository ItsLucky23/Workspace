import { useEffect, useCallback } from "react";
import { useGrid } from "../../_providers/GridContextProvider";

// const zoomLevels = [0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
const zoomLevels = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
  0.5, 0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.375,
  1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5
];
const minZoom = zoomLevels[0];
const maxZoom = zoomLevels[zoomLevels.length - 1];

export default function useOnMouseWheel() {

  const { containerRef, zoomRef, setZoom, setOffset, scrollMode } = useGrid();

  const handleWheel = useCallback((e: WheelEvent) => {
    // Check if the event target or any parent has overflow-y-auto or overflow-auto
    let element = e.target as HTMLElement;
    while (element && element !== containerRef.current) {
      const style = window.getComputedStyle(element);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
        style.overflow === 'auto' || style.overflow === 'scroll') {
        // Let the browser handle natural scrolling
        return;
      }
      element = element.parentElement as HTMLElement;
    }

    // Prevent default scroll behavior to avoid overscroll bounce
    e.preventDefault();

    const usingMouseWheel = Math.abs(e.deltaY) > 50;
    const currentZoom = zoomRef.current; // Always get the latest zoom value

    let newZoom: number | undefined;

    // Handle 'pan' scroll mode: scroll = up/down, shift+scroll = left/right, ctrl+scroll = zoom
    if (scrollMode === 'pan') {
      if (e.ctrlKey) {
        // Ctrl + scroll = zoom using the same step-based approach as default mode
        if (usingMouseWheel) {
          // Mouse wheel: use discrete zoom levels
          const closestIndex = zoomLevels.reduce((closestIdx, level, idx) => {
            const currentDiff = Math.abs(level - currentZoom);
            const closestDiff = Math.abs(zoomLevels[closestIdx] - currentZoom);
            return currentDiff < closestDiff ? idx : closestIdx;
          }, 0);
          let newIndex = closestIndex;

          if (e.deltaY < 0) {
            newIndex = Math.min(zoomLevels.length - 1, closestIndex + 1);
          } else {
            newIndex = Math.max(0, closestIndex - 1);
          }
          newZoom = zoomLevels[newIndex];
        } else {
          // Trackpad pinch: use continuous zoom
          const divider =
            currentZoom < 1
              ? 70
              : currentZoom < 3
                ? 30
                : 10;
          const additional = Math.abs(e.deltaY) / divider;
          if (e.deltaY < 0) {
            newZoom = Math.min(maxZoom, currentZoom + additional);
          } else {
            newZoom = Math.max(minZoom, currentZoom - additional);
          }
        }
      } else if (e.shiftKey) {
        // Shift + scroll = pan left/right
        // Reduce speed for smoother scrolling, especially for mouse wheel
        const speed = usingMouseWheel ? 0.5 : 1;
        setOffset(prev => ({
          x: prev.x - e.deltaY / currentZoom * speed,
          y: prev.y
        }));
        return;
      } else {
        // Normal scroll = pan up/down
        // Reduce speed for smoother scrolling, especially for mouse wheel
        const speed = usingMouseWheel ? 0.5 : 1;
        setOffset(prev => ({
          x: prev.x,
          y: prev.y - e.deltaY / currentZoom * speed
        }));
        return;
      }
    } else {
      // 'zoom' mode (default): original behavior
      if (usingMouseWheel) {
        //? here we handle zooming logic with the mouse wheel
        const closestIndex = zoomLevels.reduce((closestIdx, level, idx) => {
          const currentDiff = Math.abs(level - currentZoom);
          const closestDiff = Math.abs(zoomLevels[closestIdx] - currentZoom);
          return currentDiff < closestDiff ? idx : closestIdx;
        }, 0);
        let newIndex = closestIndex;

        if (e.deltaY < 0) {
          newIndex = Math.min(zoomLevels.length - 1, closestIndex + 1);
        } else {
          newIndex = Math.max(0, closestIndex - 1);
        }
        newZoom = zoomLevels[newIndex];

      } else {
        //? here we handle both the zooming and panning (offset) logic with the trackpad
        const zooming = e.ctrlKey;
        if (zooming) {
          const divider =
            currentZoom < 1
              ? 70
              : currentZoom < 3
                ? 30
                : 10;
          const additional = Math.abs(e.deltaY) / divider;
          if (e.deltaY < 0) { //? negative value so user is zooming in
            newZoom = Math.min(maxZoom, currentZoom + additional);
          } else { //? positive value so user is zooming out
            newZoom = Math.max(minZoom, currentZoom - additional);
          }
        } else {
          // Panning with touchpad (no ctrl key)
          const speed = 1;
          const deltaX = e.deltaX;
          const deltaY = e.deltaY;

          // Only pan if there's meaningful movement
          if (Math.abs(deltaX) > 0.1 || Math.abs(deltaY) > 0.1) {
            return setOffset(prev => ({
              x: prev.x - deltaX / currentZoom * speed,
              y: prev.y - deltaY / currentZoom * speed,
            }));
          }
        }
      }
    }

    if (!newZoom) { return; }

    const mx = e.clientX;
    const my = e.clientY;

    setOffset(prev => ({
      x: mx - ((mx - prev.x) / currentZoom) * newZoom,
      y: my - ((my - prev.y) / currentZoom) * newZoom,
    }));

    setZoom(newZoom);
  }, [containerRef, zoomRef, setZoom, setOffset, scrollMode]);

  // Register wheel event as non-passive to ensure preventDefault works
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // We need to add the event listener with { passive: false } to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, containerRef]);

  return { handleWheel };
}