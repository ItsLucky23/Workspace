import { useRef, useState, useEffect } from 'react'
import { useGrid } from '../../_providers/GridContextProvider'
import { useDrawing } from 'src/sandbox/_providers/DrawingContextProvider'
import { RenderDrawingPath } from '../../_functions/drawing/RenderDrawingPath'
import useDrawingEvents from 'src/sandbox/_functions/drawing/useDrawingEvents'
import notify from 'src/_functions/notify'
import { getStrokesBoundingBox } from '../../_functions/drawing/selectionUtils'
import { measureTextDimensions } from '../../_functions/drawing/sharedUtils'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash } from '@fortawesome/free-solid-svg-icons'

export default function DrawingLayer() {

  const {
    strokes,
    setStrokes,

    currentPoints,
    setCurrentPoints,

    drawingEnabled,
    showDrawings,

    brushSize,
    erasing,

    strokeHistory,
    setStrokeHistory,
    historyIndex,
    setHistoryIndex,

    selectedStrokeIds,
    setSelectedStrokeIds,
    selectionMode,
    showMeasurements,
    lineStyle
  } = useDrawing();

  const {
    zoom,
    offset,
  } = useGrid();

  const {
    handleDrawing,
    handlePointerUp,
    selectionBox,
    dragOffset,
    activeSnappingGuides,
    cursorStyle,
    editingTextId
  } = useDrawingEvents();

  const { marqueeBox } = useDrawing(); // Get persistent marquee box


  useEffect(() => {
    setStrokes(strokeHistory[historyIndex] || [])
    setCurrentPoints([])
  }, [historyIndex, strokeHistory, setStrokes, setCurrentPoints])

  useEffect(() => {
    if (!drawingEnabled) { return }
    // setCurrentPoints([])
    // setStrokes([])

    if (showDrawings) { return }
    notify.info({ key: "drawingsDisabled" })

  }, [drawingEnabled])

  const overlayRef = useRef<SVGSVGElement | null>(null)
  const [eraserPos, setEraserPos] = useState<{ x: number, y: number } | null>(null)

  // Calculate selection bounding box
  // We need to account for dragOffset for the selected strokes
  const getSelectionBounds = () => {
    if (selectedStrokeIds.length === 0) return null;

    // Create temporary stroke objects with applied drag if needed
    const selectedStrokes = strokes
      .filter(s => selectedStrokeIds.includes(s.id))
      .map(s => {
        if (dragOffset) {
          return {
            ...s,
            points: s.points.map(p => ({ ...p, x: p.x + dragOffset.x, y: p.y + dragOffset.y }))
          };
        }
        return s;
      });

    return getStrokesBoundingBox(selectedStrokes);
  }

  const selectionBounds = getSelectionBounds();

  return (
    <div className={`${!drawingEnabled ? "pointer-events-none" : "" }`} draggable={false} onDragStart={(e) => e.preventDefault()} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      {showDrawings && (
        <svg
          ref={overlayRef}
          width="100%"
          height="100%"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            overflow: 'visible',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            cursor: cursorStyle ? cursorStyle : (drawingEnabled ? (erasing ? 'none' : 'crosshair') : 'default')
          }}
          className={`${drawingEnabled ? (erasing ? 'cursor-none' : '') : 'pointer-events-none'}`}
          onDragStart={(e) => e.preventDefault()}
          onMouseDown={(e) => { e.preventDefault(); }}
          onPointerDown={(e) => handleDrawing(e, setEraserPos, overlayRef)}
          onPointerMove={(e) => handleDrawing(e, setEraserPos, overlayRef)}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setEraserPos(null)}
        />
      )}

      <div
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
        className={`h-full w-full`}
      >
        {showDrawings && (
          <svg
            width="100%"
            height="100%"
            style={{ overflow: 'visible', pointerEvents: 'none' }}
          >
            {strokes.map(s => {
              const isSelected = selectedStrokeIds.includes(s.id);
              const transform = isSelected && dragOffset ? `translate(${dragOffset.x}, ${dragOffset.y})` : undefined;

              if (s.text !== undefined) {
                const p = s.points[0];
                const isEditing = editingTextId === s.id;
                const fontSize = s.points[0].size || 20;

                // Calculate dimensions dynamically from content
                const { width: calculatedWidth, height: calculatedHeight } = measureTextDimensions(s.text, fontSize);

                return (
                  <g key={s.id} transform={transform} style={{ opacity: isSelected && dragOffset ? 0.7 : 1 }}>
                    <foreignObject
                      x={p.x}
                      y={p.y}
                      width={calculatedWidth}
                      height={calculatedHeight}
                      style={{ overflow: 'visible' }}
                    >
                      {isEditing ? (
                        <textarea
                          ref={(el) => { if (el) { el.focus(); } }}
                          className="bg-transparent outline-none resize-none text-text-primary w-full h-full p-1"
                          style={{
                            fontSize: fontSize,
                            lineHeight: '1.2',
                            fontFamily: 'sans-serif',
                            color: s.points[0].color,
                            overflow: 'hidden',
                            whiteSpace: 'pre',
                            caretColor: '#FFFFFF',
                            fontWeight: 500
                          }}
                          value={s.text}
                          onChange={(e) => {
                            // Update text
                            const val = e.target.value;

                            // Measure width using canvas context
                            const canvas = document.createElement('canvas');
                            const context = canvas.getContext('2d');
                            let measuredWidth = 50;
                            if (context) {
                              context.font = `${fontSize}px sans-serif`;
                              const lines = val.split('\n');
                              let maxWidth = 0;
                              lines.forEach(line => {
                                const w = context.measureText(line).width;
                                if (w > maxWidth) maxWidth = w;
                              });
                              measuredWidth = Math.max(50, maxWidth + 20); // Add padding
                            }

                            // Update height
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                            const newHeight = e.target.scrollHeight;

                            setStrokes(prev => prev.map(st => {
                              if (st.id === s.id) {
                                return { ...st, text: val, width: measuredWidth, height: Math.max(30, newHeight) };
                              }
                              return st;
                            }));
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div
                          className="p-1 w-full h-full select-none"
                          style={{
                            fontSize: fontSize,
                            lineHeight: '1.2',
                            fontFamily: 'sans-serif',
                            color: s.points[0].color,
                            pointerEvents: 'none',
                            whiteSpace: 'pre'
                          }}
                        >
                          {s.text}
                        </div>
                      )}
                    </foreignObject>
                  </g>
                )
              }

              return (
                <g key={s.id} transform={transform} style={{ opacity: isSelected && dragOffset ? 0.7 : 1 }}>
                  <RenderDrawingPath points={s.points} zoom={zoom} fill={s.fill} strokeData={s} />
                </g>
              );
            })}

            {/* Selection Bounding Box */}
            {selectionBounds && drawingEnabled && (selectionMode || selectedStrokeIds.length > 0) && (
              <>
                <rect
                  x={selectionBounds.minX}
                  y={selectionBounds.minY}
                  width={selectionBounds.maxX - selectionBounds.minX}
                  height={selectionBounds.maxY - selectionBounds.minY}
                  fill="none"
                  stroke="#00aaff"
                  strokeWidth={Math.max(1, 1 / zoom)}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Resize Handles - Hide if editing text */}
                {!editingTextId && (
                  <>
                    <rect
                      x={selectionBounds.minX - 4 / zoom}
                      y={selectionBounds.minY - 4 / zoom}
                      width={8 / zoom}
                      height={8 / zoom}
                      fill="white"
                      stroke="#00aaff"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'nwse-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => handleDrawing(e, setEraserPos, overlayRef)}
                    />
                    <rect
                      x={selectionBounds.maxX - 4 / zoom}
                      y={selectionBounds.minY - 4 / zoom}
                      width={8 / zoom}
                      height={8 / zoom}
                      fill="white"
                      stroke="#00aaff"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'nesw-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => handleDrawing(e, setEraserPos, overlayRef)}
                    />
                    <rect
                      x={selectionBounds.maxX - 4 / zoom}
                      y={selectionBounds.maxY - 4 / zoom}
                      width={8 / zoom}
                      height={8 / zoom}
                      fill="white"
                      stroke="#00aaff"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'nwse-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => handleDrawing(e, setEraserPos, overlayRef)}
                    />
                    <rect
                      x={selectionBounds.minX - 4 / zoom}
                      y={selectionBounds.maxY - 4 / zoom}
                      width={8 / zoom}
                      height={8 / zoom}
                      fill="white"
                      stroke="#00aaff"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'nesw-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => handleDrawing(e, setEraserPos, overlayRef)}
                    />

                    <foreignObject
                      x={selectionBounds.maxX + 10 / zoom}
                      y={selectionBounds.minY}
                      width={40 / zoom}
                      height={40 / zoom}
                      style={{ overflow: 'visible', pointerEvents: 'auto' }}
                    >
                      <button
                        className="flex items-center justify-center bg-background2 rounded-full text-wrong outline-1 outline-wrong hover:bg-background2-hover transition-colors"
                        style={{
                          width: 32 / zoom,
                          height: 32 / zoom,
                          fontSize: 14 / zoom,
                          pointerEvents: 'auto',
                          cursor: 'pointer'
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const newStrokes = strokes.filter(s => !selectedStrokeIds.includes(s.id));
                          setStrokes(newStrokes);
                          setStrokeHistory(prev => [...prev.slice(0, historyIndex + 1), newStrokes]);
                          setHistoryIndex(prev => prev + 1);
                          setSelectedStrokeIds([]);
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </foreignObject>
                  </>
                )}
              </>
            )}

            {activeSnappingGuides && activeSnappingGuides.map((guide, i) => {
              if (guide.orientation === 'vertical') {
                return (
                  <line
                    key={`guide-${i}`}
                    x1={guide.position}
                    y1={-100000}
                    x2={guide.position}
                    y2={100000}
                    stroke="#ff0044"
                    strokeWidth={1 / zoom}
                    strokeDasharray="4 4"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              } else {
                return (
                  <line
                    key={`guide-${i}`}
                    x1={-100000}
                    y1={guide.position}
                    x2={100000}
                    y2={guide.position}
                    stroke="#ff0044"
                    strokeWidth={1 / zoom}
                    strokeDasharray="4 4"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              }
            })}

            {selectionBox && (
              <rect
                x={selectionBox.x}
                y={selectionBox.y}
                width={selectionBox.width}
                height={selectionBox.height}
                fill="rgba(0, 170, 255, 0.1)"
                stroke="#00aaff"
                strokeWidth={Math.max(1, 1 / zoom)}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {marqueeBox && (
              <rect
                x={marqueeBox.x}
                y={marqueeBox.y}
                width={marqueeBox.width}
                height={marqueeBox.height}
                fill="rgba(0, 170, 255, 0.05)"
                stroke="#00aaff"
                strokeWidth={Math.max(2, 2 / zoom)}
                strokeDasharray="8 4"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {currentPoints.length > 1 && <g><RenderDrawingPath points={currentPoints} zoom={zoom} strokeData={{ lineStyle }} /></g>}

            {showMeasurements && strokes.map(s => {
              const isSelected = selectedStrokeIds.includes(s.id);
              let strokeToCheck = s;
              if (isSelected && dragOffset) {
                strokeToCheck = {
                  ...s,
                  points: s.points.map(p => ({ ...p, x: p.x + dragOffset.x, y: p.y + dragOffset.y }))
                };
              }

              const bounds = getStrokesBoundingBox([strokeToCheck]);
              if (!bounds) return null;
              const width = Math.round(bounds.maxX - bounds.minX);
              const height = Math.round(bounds.maxY - bounds.minY);

              if (width <= 0 && height <= 0) return null;
              if (width < 2 && height < 2) return null;

              return (
                <g key={`measure-${s.id}`}>
                  {width > 0 && (
                    <text
                      x={bounds.minX + (bounds.maxX - bounds.minX) / 2}
                      y={bounds.minY - 10 / zoom}
                      fill="#00aaff"
                      fontSize={12 / zoom}
                      textAnchor="middle"
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {width}
                    </text>
                  )}
                  {height > 0 && (
                    <text
                      x={bounds.minX - 10 / zoom}
                      y={bounds.minY + (bounds.maxY - bounds.minY) / 2}
                      fill="#00aaff"
                      fontSize={12 / zoom}
                      textAnchor="end"
                      dominantBaseline="middle"
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {height}
                    </text>
                  )}
                </g>
              )
            })}

            {showMeasurements && currentPoints.length > 0 && (() => {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const p of currentPoints) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
              }
              if (minX === Infinity) return null;

              const width = Math.round(maxX - minX);
              const height = Math.round(maxY - minY);

              return (
                <g>
                  <text
                    x={minX + width / 2}
                    y={minY - 10 / zoom}
                    fill="#00aaff"
                    fontSize={12 / zoom}
                    textAnchor="middle"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {width}
                  </text>
                  <text
                    x={minX - 10 / zoom}
                    y={minY + height / 2}
                    fill="#00aaff"
                    fontSize={12 / zoom}
                    textAnchor="end"
                    dominantBaseline="middle"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {height}
                  </text>
                </g>
              );
            })()}

            {erasing && eraserPos && (
              <circle
                cx={eraserPos.x}
                cy={eraserPos.y}
                r={brushSize / 2}
                fill="none"
                stroke="white"
                strokeDasharray="4 4"
                strokeWidth={1 / zoom}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
      </div>
    </div>
  )
}
