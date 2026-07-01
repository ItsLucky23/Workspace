
import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { clientToWorld } from "./clientToWorld";
import { useGrid } from "src/sandbox/_providers/GridContextProvider";
import { ErasingMode, useDrawing, StrokeData } from "src/sandbox/_providers/DrawingContextProvider";
import { eraseStokePoint, eraseStroke } from "./eraseStroke";
import { generateShapePoints } from "./generateShapePoints";
import { hitTestStroke, isStrokeInRect, getStrokesBoundingBox, isPointInRect, hitTestResizeHandle } from "./selectionUtils";
import { getSnappingGuides, SnappingGuide } from "./snappingUtils";
import { isPointInPolygon } from "./sharedUtils";

export default function useDrawingEvents() {

  const {
    strokes,
    setStrokes,

    currentPoints,
    setCurrentPoints,

    drawingEnabled,

    brushSize,
    erasing,
    brushColor,

    setStrokeHistory,
    historyIndex,
    setHistoryIndex,

    activeShape,

    selectionMode,
    selectedStrokeIds,
    setSelectedStrokeIds,

    snappingEnabled,
    fillMode,
    marqueeMode,

    setMarqueeBox,
    textMode,
    setTextMode,
    lineStyle
  } = useDrawing();

  const {
    zoom,
    offset,
  } = useGrid();

  const startPoint = useRef<{ x: number, y: number } | null>(null);

  // Selection transient state
  const [selectionBox, setSelectionBox] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number, y: number } | null>(null);
  const [activeSnappingGuides, setActiveSnappingGuides] = useState<SnappingGuide[]>([]);

  // Internal state machine for selection interaction
  const selectionState = useRef<'IDLE' | 'POINTER_DOWN_ON_STROKE' | 'POINTER_DOWN_ON_EMPTY' | 'DRAGGING_STROKES' | 'DRAGGING_SELECTION_BOX' | 'RESIZING'>('IDLE');
  const initialSelectedIds = useRef<string[]>([]); // Snapshot of selection at drag start
  const pointerDownPos = useRef<{ x: number, y: number } | null>(null);
  const hitStrokeIdRef = useRef<string | null>(null);

  // Resize state
  const resizeHandleRef = useRef<'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const initialResizeBoundsRef = useRef<{ minX: number, minY: number, maxX: number, maxY: number } | null>(null);
  const initialResizeStrokesRef = useRef<StrokeData[]>([]);

  // Text Tool State
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null); // To focus

  useEffect(() => {
    if (!textMode) {
      setEditingTextId(null);
    }
  }, [textMode]);


  const mousePosRef = useRef<{ x: number, y: number } | null>(null);

  // Cursor state
  const [cursorStyle, setCursorStyle] = useState<string | null>(null);

  const handleDrawing = useCallback((
    e: React.PointerEvent<Element>,
    setEraserPos: Dispatch<SetStateAction<{ x: number, y: number } | null>>,
    overlayRef: React.RefObject<SVGSVGElement | null>
  ) => {
    if (!drawingEnabled) { return }

    const firstHit = e.type === 'pointerdown';
    const { x, y } = clientToWorld(e.clientX, e.clientY, overlayRef.current, offset, zoom)

    if (firstHit && overlayRef.current) {
      try {
        overlayRef.current.setPointerCapture(e.pointerId);
      } catch (err) {
        console.error("Failed to capture pointer:", err);
      }
    }

    mousePosRef.current = { x, y };

    // --- HOVER / CURSOR LOGIC (Passive) ---
    // If not dragging/drawing, we update cursor based on what's under it
    if (e.buttons === 0 && !erasing && !marqueeMode) {
      // 1. Check Resize Handles FIRST (if selections exist)
      if (selectedStrokeIds.length > 0) {
        const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
        const bounds = getStrokesBoundingBox(selectedStrokes);
        if (bounds) {
          const handle = hitTestResizeHandle({ x, y }, bounds, zoom);
          if (handle) {
            // Map handle to cursor style
            let cursor = 'default';
            if (handle === 'nw' || handle === 'se') cursor = 'nwse-resize';
            if (handle === 'ne' || handle === 'sw') cursor = 'nesw-resize';
            setCursorStyle(cursor);
            setEraserPos(null); // Hide eraser
            return;
          }
        }
      }

      // 2. Check Selection (Dragging existing selection) or Hovering selectable items
      // We allow dragging IF selectionMode OR (we have a selection and we are in 'hybrid' mode?)
      // Actually, if we have a selection, we can always drag it if we click inside.

      let hoverCursor: string | null = null;
      let hoveringStroke = false;

      // Check inside existing selection
      if (selectedStrokeIds.length > 0) {
        const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
        const bounds = getStrokesBoundingBox(selectedStrokes);
        if (bounds && isPointInRect({ x, y }, bounds)) {
          hoverCursor = 'move';
          hoveringStroke = true;
        }
      }

      // Check for unselected strokes (only if selection mode)
      // In Draw Mode, we do NOT want to show 'move' cursor on unselected items, because clicking them would just draw.
      if (!hoveringStroke && selectionMode) {
        // Optimization: Reverse loop
        for (let i = strokes.length - 1; i >= 0; i--) {
          if (hitTestStroke({ x, y }, strokes[i], zoom)) {
            hoverCursor = 'move'; // Or 'pointer'? 'move' implies draggable.
            break;
          }
        }
      }

      setCursorStyle(hoverCursor);
      setEraserPos(null); // Hide eraser when hovering UI elements? 

      return; // Passive move, done.
    }

    // Reset cursor if we start drawing/interacting or move to empty space (handled by fallback in UI)
    // Persist cursor if we are dragging/resizing
    if (e.buttons === 1) {
      const state = selectionState.current;
      if (state === 'DRAGGING_STROKES' || state === 'POINTER_DOWN_ON_STROKE') {
        setCursorStyle('move');
      } else if (state === 'RESIZING') {
        const h = resizeHandleRef.current;
        if (h === 'nw' || h === 'se') setCursorStyle('nwse-resize');
        else if (h === 'ne' || h === 'sw') setCursorStyle('nesw-resize');
        else setCursorStyle('default');
      } else {
        setCursorStyle(null); // Default to crosshair/none for drawing
      }
    }



    setEraserPos({ x, y })


    // --- SELECTION OVERRIDE LOGIC ---
    // If not in selection mode, but we have items selected, check if we are interacting with them.
    let overrideToSelection = false;
    // We only check for override on the initial CLICK.
    // However, if we are DRAGGING (buttons=1, not firstHit), we need to know if we are in an override state!
    // But selectionState.current handles that once started.
    // The issue is: on Move, 'firstHit' is false. overrideToSelection becomes false.
    // But 'selectionState.current' should preserve the state.

    if (!selectionMode && selectedStrokeIds.length > 0 && e.buttons === 1 && firstHit) {
      const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
      const bounds = getStrokesBoundingBox(selectedStrokes);

      // Check interaction
      if (bounds) {
        if (hitTestResizeHandle({ x, y }, bounds, zoom)) {
          overrideToSelection = true;
        } else if (isPointInRect({ x, y }, bounds)) {
          overrideToSelection = true;
        }
      }
    }

    // Also, if we are ALREADY interacting (dragging), we treat it as selection mode effectively.
    if (!selectionMode && selectionState.current !== 'IDLE') {
      overrideToSelection = true;
    }

    // --- SELECTION MODE LOGIC ---
    if (selectionMode || overrideToSelection || marqueeMode) {
      if (e.buttons !== 1) {
        return;
      }

      if (firstHit) {
        // MOUSE DOWN
        pointerDownPos.current = { x, y };
        setActiveSnappingGuides([]);

        // PRIORITY: Marquee Mode (Force Box Selection)
        if (marqueeMode) {
          selectionState.current = 'DRAGGING_SELECTION_BOX';
          // Clear selection unless Shift/Ctrl
          if (!e.ctrlKey && !e.shiftKey) {
            setSelectedStrokeIds([]);
            setMarqueeBox(null);
          }
          return;
        }

        // 0. Check Resize Handles FIRST
        if (selectedStrokeIds.length > 0) {
          const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const bounds = getStrokesBoundingBox(selectedStrokes);
          if (bounds) {
            const handle = hitTestResizeHandle({ x, y }, bounds, zoom);
            if (handle) {
              selectionState.current = 'RESIZING';
              resizeHandleRef.current = handle;
              initialResizeBoundsRef.current = bounds;
              initialResizeStrokesRef.current = JSON.parse(JSON.stringify(selectedStrokes));
              return; // Stop here, we are resizing
            }
          }
        }

        // 0.5 Check for specific hit stroke FIRST
        let hitStrokeId: string | null = null;
        for (let i = strokes.length - 1; i >= 0; i--) {
          if (hitTestStroke({ x, y }, strokes[i], zoom)) {
            hitStrokeId = strokes[i].id;
            break;
          }
        }

        // 1. Check inside selection
        let clickedInsideSelection = false;
        if (selectedStrokeIds.length > 0) {
          const selectedStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
          const bounds = getStrokesBoundingBox(selectedStrokes);
          if (bounds && isPointInRect({ x, y }, bounds)) {
            if (!e.ctrlKey && !e.shiftKey) {
              clickedInsideSelection = true;
              selectionState.current = 'POINTER_DOWN_ON_STROKE';
              // Store hit stroke even if inside selection, for single-click selection
              hitStrokeIdRef.current = hitStrokeId;
              initialSelectedIds.current = [...selectedStrokeIds];
            }
          }
        }

        // If we clicked inside selection (or resize handle), we are interacting with selection.
        if (clickedInsideSelection) {
          return; // Consumed event
        }

        // If we are overriding (Hybrid Mode) and we didn't click inside selection or resize handle:
        if (overrideToSelection && !selectionMode) {
          // Fall through to drawing logic
          // do NOT return
        } else {
          // Normal Selection Mode behavior: Check for other strokes to select
          if (hitStrokeId) {
            selectionState.current = 'POINTER_DOWN_ON_STROKE';
            hitStrokeIdRef.current = hitStrokeId;
            const isSelected = selectedStrokeIds.includes(hitStrokeId);
            const isModifier = e.ctrlKey || e.shiftKey;

            if (isModifier) {
              initialSelectedIds.current = [...selectedStrokeIds];
            } else {
              if (isSelected) {
                initialSelectedIds.current = [...selectedStrokeIds];
              } else {
                initialSelectedIds.current = [hitStrokeId];
                setSelectedStrokeIds([hitStrokeId]);
              }
            }
          } else {
            selectionState.current = 'POINTER_DOWN_ON_EMPTY';
            initialSelectedIds.current = [...selectedStrokeIds];
          }
        }
        return;
      } else {
        // MOUSE MOVE
        if (!pointerDownPos.current) return;

        const dx = x - pointerDownPos.current.x;
        const dy = y - pointerDownPos.current.y;

        // --- RESIZING ---
        if (selectionState.current === 'RESIZING') {
          const handle = resizeHandleRef.current;
          const initBounds = initialResizeBoundsRef.current;
          if (!handle || !initBounds) return;

          // Anchor logic
          let anchorX = 0, anchorY = 0;
          if (handle === 'nw') { anchorX = initBounds.maxX; anchorY = initBounds.maxY; }
          else if (handle === 'ne') { anchorX = initBounds.minX; anchorY = initBounds.maxY; }
          else if (handle === 'se') { anchorX = initBounds.minX; anchorY = initBounds.minY; }
          else if (handle === 'sw') { anchorX = initBounds.maxX; anchorY = initBounds.minY; }

          // Re-calculate original handle pos
          let origX = (handle == 'nw' || handle == 'sw') ? initBounds.minX : initBounds.maxX;
          let origY = (handle == 'nw' || handle == 'ne') ? initBounds.minY : initBounds.maxY;

          const oldW = Math.abs(origX - anchorX);
          const oldH = Math.abs(origY - anchorY);

          // Current bounds width/height
          // We use the pointer position x, y as the new handle position
          const newW = Math.abs(x - anchorX);
          const newH = Math.abs(y - anchorY);

          const scaleX = oldW > 0.01 ? newW / oldW : 1;
          const scaleY = oldH > 0.01 ? newH / oldH : 1;

          const updatedStrokes = strokes.map(s => {
            const initStroke = initialResizeStrokesRef.current.find(is => is.id === s.id);
            if (initStroke) {
              if (s.text !== undefined) {
                // Resize Text: Scale font size and move X position only
                // Keep Y position fixed - text only scales horizontally

                const newPoints = initStroke.points.map(p => ({
                  ...p,
                  // Move X position with anchor, keep Y fixed
                  x: anchorX + (p.x - anchorX) * scaleX,
                  y: p.y, // Keep Y position fixed
                  // Scale font size proportionally
                  size: Math.max(8, p.size * scaleX)
                }));

                return {
                  ...s,
                  points: newPoints
                }
              }

              return {
                ...s,
                points: initStroke.points.map(p => ({
                  ...p,
                  x: anchorX + (p.x - anchorX) * scaleX,
                  y: anchorY + (p.y - anchorY) * scaleY,
                  size: p.size * ((scaleX + scaleY) / 2) // Approximate size scaling
                }))
              };
            }
            return s;
          });
          setStrokes(updatedStrokes);
          return;
        }

        // --- DRAG / BOX SELECT ---
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (selectionState.current === 'POINTER_DOWN_ON_STROKE' || selectionState.current === 'POINTER_DOWN_ON_EMPTY') {
          if (dist > 5 / zoom) {
            if (selectionState.current === 'POINTER_DOWN_ON_STROKE') {
              selectionState.current = 'DRAGGING_STROKES';
            } else {
              if (selectionMode && !overrideToSelection) {
                selectionState.current = 'DRAGGING_SELECTION_BOX';
              }
            }
          }
        }

        if (selectionState.current === 'DRAGGING_STROKES') {
          // Snapping Logic
          if (snappingEnabled) {
            const movingStrokes = strokes.filter(s => selectedStrokeIds.includes(s.id));
            const otherStrokes = strokes.filter(s => !selectedStrokeIds.includes(s.id));

            const { dx: snappedDx, dy: snappedDy, guides } = getSnappingGuides(movingStrokes, otherStrokes, { x: dx, y: dy }, zoom);

            setDragOffset({ x: snappedDx, y: snappedDy });
            setActiveSnappingGuides(guides);
          } else {
            setDragOffset({ x: dx, y: dy });
            setActiveSnappingGuides([]);
          }
          return; // Consumed drag
        } else if (selectionState.current === 'DRAGGING_SELECTION_BOX') {
          const start = pointerDownPos.current!;
          const minX = Math.min(start.x, x);
          const minY = Math.min(start.y, y);
          const width = Math.abs(start.x - x);
          const height = Math.abs(start.y - y);
          setSelectionBox({ x: minX, y: minY, width, height });
          return; // Consumed drag
        }

        // Return if consuming interaction
        if (selectionMode || overrideToSelection) return;
      }
    }
    // ----------------------------

    if (e.buttons !== 1) {
      startPoint.current = null;
      return
    }

    if (erasing !== ErasingMode.DISABLED) {
      if (erasing == ErasingMode.FULL) {
        const newStrokes = eraseStroke(x, y, brushSize, strokes)
        if (newStrokes) setStrokes(newStrokes)
      } else {
        // For partial erase, use smaller radius for finer control
        const newStrokes = eraseStokePoint(x, y, brushSize / 2, strokes)
        if (newStrokes) setStrokes(newStrokes)
      }
      return
    }

    if (fillMode) {
      if (!firstHit) return;


      // Find hit stroke (Check inside first, then partial hit if needed?)
      // We prioritize "inside" hits for closed shapes.
      // We iterate structure topmost first? (reverse index)
      let targetStrokeId: string | null = null;

      for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        if (s.points.length < 3) continue;

        // Check if closed (visually)
        const start = s.points[0];
        const end = s.points[s.points.length - 1];
        const dist = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
        // Actually generateShapePoints may not repeat the first point.
        // Let's assume visual closure is enough or strict closure.

        // Raycasting works best if the polygon is effectively closed.
        // If we treat the points as a polygon, the edge (last -> first) is implied.

        if (isPointInPolygon({ x, y }, s.points)) {
          targetStrokeId = s.id;
          break;
        }

        // Also check edge hit as fallback?
        if (hitTestStroke({ x, y }, s, zoom)) {
          targetStrokeId = s.id;
          break;
        }
      }

      if (targetStrokeId) {
        const newStrokes = strokes.map(s => {
          if (s.id === targetStrokeId) {
            // Update Fill AND Outline Color
            return {
              ...s,
              fill: brushColor,
              points: s.points.map(p => ({ ...p, color: brushColor }))
            };
          }
          return s;
        });
        setStrokes(newStrokes);
        setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
        setHistoryIndex(prev => prev + 1);
      } else {
        console.log("No shape found to fill at", x, y);
      }
      return;
    }

    if (activeShape) {
      if (firstHit) {
        // Start Drawing a Shape
        startPoint.current = { x, y };
        setCurrentPoints([{ x, y, color: brushColor, size: brushSize }]);
        setActiveSnappingGuides([]); // Reset guides

        // If we click to draw, we should Deselect others
        setSelectedStrokeIds([]);

      } else if (startPoint.current) {
        let endX = x;
        let endY = y;

        // Snapping while drawing
        if (snappingEnabled) {
          const tempPoints = generateShapePoints(startPoint.current, { x, y }, activeShape, brushSize, brushColor);
          const tempStroke: StrokeData = { id: 'temp', points: tempPoints };
          const { guides, dx, dy } = getSnappingGuides([tempStroke], strokes, { x: 0, y: 0 }, zoom);

          endX += dx;
          endY += dy;
          setActiveSnappingGuides(guides);
        }

        const points = generateShapePoints(startPoint.current, { x: endX, y: endY }, activeShape, brushSize, brushColor);
        setCurrentPoints(points);
      }
      return;
    }



    // --- TEXT TOOL LOGIC ---
    if (textMode && firstHit && e.buttons === 1) {
      // If we click on an existing text, we might want to edit it?
      // Let's check hit test first.
      let hitTextId = null;
      // Check top-most text
      for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        if (s.text && hitTestStroke({ x, y }, s, zoom)) {
          hitTextId = s.id;
          break;
        }
      }

      if (hitTextId) {
        // Clicked on an existing text field

        // First, clean up current editing session if any
        if (editingTextId && editingTextId !== hitTextId) {
          const currentTextStroke = strokes.find(s => s.id === editingTextId);
          if (currentTextStroke && (!currentTextStroke.text || currentTextStroke.text.trim() === '')) {
            setStrokes(prev => prev.filter(s => s.id !== editingTextId));
          }
          setEditingTextId(null);
        }

        // Check if this text is already selected
        const isAlreadySelected = selectedStrokeIds.includes(hitTextId);

        if (isAlreadySelected && !editingTextId) {
          // Second click on already-selected text -> enter edit mode
          setEditingTextId(hitTextId);
        } else if (!isAlreadySelected) {
          // First click -> select only (no edit)
          setSelectedStrokeIds([hitTextId]);
          setEditingTextId(null); // Make sure not editing
        }
        // If clicking same text we're already editing, do nothing (stay in edit)

      } else {
        // Clicked empty space

        // Clean up empty text if we were editing, then just unfocus (don't create new)
        if (editingTextId) {
          const currentTextStroke = strokes.find(s => s.id === editingTextId);
          if (currentTextStroke && (!currentTextStroke.text || currentTextStroke.text.trim() === '')) {
            setStrokes(prev => prev.filter(s => s.id !== editingTextId));
          }
          setEditingTextId(null);
          setSelectedStrokeIds([]); // Also deselect
          return; // Just unfocus, don't create new text
        }

        // If we have a selection, deselect it and RETURN (Do not create new text yet)
        if (selectedStrokeIds.length > 0) {
          setSelectedStrokeIds([]);
          return;
        }

        // No selection, no editing - create new text field
        const newId = crypto.randomUUID();
        const newStroke: StrokeData = {
          id: newId,
          points: [{ x, y, color: brushColor, size: 24 }], // Point 0 is origin, use fixed 24px font
          text: "", // Empty start
          width: 300,
          height: 150
        };

        setStrokes(prev => [...prev, newStroke]);
        setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), [...strokes, newStroke]]);
        setHistoryIndex(prev => prev + 1);

        setSelectedStrokeIds([]); // DO NOT select it initially, just edit
        setEditingTextId(newId);
        // We stay in text mode.
      }
      return;
    }

    if (textMode) return;

    if (firstHit) {
      setCurrentPoints([{ x, y, color: brushColor, size: brushSize }])
      setSelectedStrokeIds([]); // Deselect on freehand drawing too
      return
    }

    setCurrentPoints(prev => {
      const last = prev[prev.length - 1]

      if (last) {
        const dist = Math.sqrt(Math.pow(last.x - x, 2) + Math.pow(last.y - y, 2))
        if (dist < 1 / zoom) return prev
      }

      if (!last || last.x !== x || last.y !== y) {
        return [...prev, { x, y, color: brushColor, size: brushSize }]
      }
      return prev
    })

  }, [zoom, offset, drawingEnabled, erasing, brushColor, brushSize, strokes, setStrokes, setCurrentPoints, activeShape, selectionMode, selectedStrokeIds, setSelectedStrokeIds, snappingEnabled, fillMode, marqueeMode, textMode, editingTextId])

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingEnabled) { return }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { }

    setActiveSnappingGuides([]); // Clear guides

    // Handle Selection State Transitions
    if (selectionState.current !== 'IDLE') {
      if (selectionState.current === 'RESIZING') {
        setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), strokes]);
        setHistoryIndex(prev => prev + 1);
        resizeHandleRef.current = null;
        initialResizeBoundsRef.current = null;
        initialResizeStrokesRef.current = [];
      }
      else if (selectionState.current === 'DRAGGING_STROKES') {
        if (dragOffset) {
          const newStrokes = strokes.map(s => {
            if (selectedStrokeIds.includes(s.id)) {
              return {
                ...s,
                points: s.points.map(p => ({ ...p, x: p.x + dragOffset.x, y: p.y + dragOffset.y }))
              };
            }
            return s;
          });
          setStrokes(newStrokes);
          setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
          setHistoryIndex(prev => prev + 1);
        }
        setDragOffset(null);
      } else if (selectionState.current === 'DRAGGING_SELECTION_BOX') {
        if (selectionBox) {
          if (marqueeMode) {
            // Persist the box for Export
            setMarqueeBox(selectionBox);
            // DO NOT select strokes. This is purely for export cropping.
            // Ensure no selection is active to avoid confusion
            setSelectedStrokeIds([]);
          } else {
            const newSelection = strokes.filter(s => isStrokeInRect(s, selectionBox)).map(s => s.id);
            if (e.ctrlKey || e.shiftKey) {
              const combined = new Set(selectedStrokeIds);
              newSelection.forEach(id => {
                if (combined.has(id)) combined.delete(id);
                else combined.add(id);
              });
              setSelectedStrokeIds(Array.from(combined));
            } else {
              setSelectedStrokeIds(newSelection);
            }
          }
        }
        setSelectionBox(null);
      } else if (selectionState.current === 'POINTER_DOWN_ON_STROKE') {
        // It was just a click
        if (e.ctrlKey || e.shiftKey) {
          if (hitStrokeIdRef.current) {

            // Toggle selection
            const idToToggle = hitStrokeIdRef.current;
            if (selectedStrokeIds.includes(idToToggle)) {
              setSelectedStrokeIds(prev => prev.filter(pid => pid !== idToToggle));
            } else {
              setSelectedStrokeIds(prev => [...prev, idToToggle]);
            }
          }
        } else {
          // Simple Click without modifier -> Select ONLY this one 
          if (hitStrokeIdRef.current) {
            setSelectedStrokeIds([hitStrokeIdRef.current]);

            // Check if it is TEXT
            const clickedStroke = strokes.find(s => s.id === hitStrokeIdRef.current);
            if (clickedStroke?.text !== undefined) {
              // If we are in Text Mode OR Selection Mode, allow editing?
              // User said: "clicking on it again makes us edit it again"
              // If it's selected, and we click it again...
              if (initialSelectedIds.current.includes(hitStrokeIdRef.current)) {
                setEditingTextId(hitStrokeIdRef.current);
              } else {
                // First click selects it (already done above).
                // Maybe we only edit if Text Mode?
                // User said: "clicking outside makes us untoggle... clicking on it again makes us edit"
                // Logic: If already selected, enter edit mode.

                // Actually, if we are in text mode, maybe first click edits?
                if (textMode) setEditingTextId(hitStrokeIdRef.current);
              }
            }
          }
        }
      } else if (selectionState.current === 'POINTER_DOWN_ON_EMPTY') {
        setSelectedStrokeIds([]);
        // Clicked empty: Commit text if editing
        setEditingTextId(null);
      }

      selectionState.current = 'IDLE';
      pointerDownPos.current = null;
      hitStrokeIdRef.current = null;

      return;
    }

    if (erasing) {
      setStrokeHistory(prev => {
        const base = prev.slice(0, historyIndex + 1)
        return [...base, strokes]
      })
      setHistoryIndex(prev => prev + 1)
      return
    }

    if (activeShape || !selectionMode) {
      // We might have just finished drawing.
      if (currentPoints.length > 1) {
        const newId = crypto.randomUUID();
        setStrokeHistory(prev => {
          const base = prev.slice(0, historyIndex + 1)
          const currentSnapshot = prev[historyIndex] || []
          const newSnapshot = [...currentSnapshot, {
            id: newId,
            points: currentPoints,
            lineStyle: lineStyle, // Apply current line style
          }]
          return [...base, newSnapshot]
        });
        setHistoryIndex(prev => prev + 1)

        // Auto-Select the new stroke!
        setSelectedStrokeIds([newId]);
        setCurrentPoints([])
        return;
      }
      setCurrentPoints([])
    }
  }, [drawingEnabled, erasing, strokes, currentPoints, historyIndex, setStrokeHistory, setHistoryIndex, setCurrentPoints, selectionMode, selectedStrokeIds, setSelectedStrokeIds, selectionBox, dragOffset, lineStyle])

  return {
    handleDrawing,
    handlePointerUp,
    selectionBox,
    dragOffset,
    activeSnappingGuides,
    cursorStyle,
    editingTextId,
    setEditingTextId
  }
}
