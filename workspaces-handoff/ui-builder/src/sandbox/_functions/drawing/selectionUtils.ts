
import { DrawingPoint, StrokeData } from "src/sandbox/_providers/DrawingContextProvider";
import { measureTextDimensions } from "./sharedUtils";

/**
 * Calculates the distance between a point (p) and a line segment (v - w).
 */
function distToSegmentSquared(p: { x: number, y: number }, v: { x: number, y: number }, w: { x: number, y: number }) {
  const l2 = ((v.x - w.x) * (v.x - w.x)) + ((v.y - w.y) * (v.y - w.y));
  if (l2 === 0) return ((p.x - v.x) * (p.x - v.x)) + ((p.y - v.y) * (p.y - v.y));
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return ((p.x - v.x - t * (w.x - v.x)) * (p.x - v.x - t * (w.x - v.x))) +
    ((p.y - v.y - t * (w.y - v.y)) * (p.y - v.y - t * (w.y - v.y)));
}

function distToSegment(p: { x: number, y: number }, v: { x: number, y: number }, w: { x: number, y: number }) {
  return Math.sqrt(distToSegmentSquared(p, v, w));
}

/**
 * Checks if a point is close enough to any segment in the stroke.
 */
export function hitTestStroke(point: { x: number, y: number }, stroke: StrokeData, zoom: number): boolean {
  // TEXT HIT TEST
  if (stroke.text !== undefined) {
    if (stroke.points.length === 0) return false;
    const p = stroke.points[0];
    const fontSize = p.size || 20;

    const { width: w, height: h } = measureTextDimensions(stroke.text, fontSize);

    const padding = 10 / zoom; // Generous padding for easier selection
    return point.x >= p.x - padding && point.x <= p.x + w + padding &&
      point.y >= p.y - padding && point.y <= p.y + h + padding;
  }

  const { points } = stroke;
  if (points.length === 0) return false;

  // Base threshold, adjusted by zoom. Use largest point size in stroke as rough thickness guide?
  // Or just a fixed "comfortable" click radius.
  // Prompt says: "close enough to the rendered vector path".
  // Let's use a base pixel threshold + stroke width logic.

  // Average stroke width for this stroke? Or max?
  const strokeWidth = points[0]?.size || 10;
  const hitThreshold = (strokeWidth / 2) + (10 / zoom); // 10 screen pixels tolerance

  if (points.length === 1) {
    const p = points[0];
    const dist = Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2));
    return dist <= hitThreshold;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (distToSegment(point, p1, p2) <= hitThreshold) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if the stroke is considered "inside" the selection box.
 * Criteria: > 40% of points inside.
 */
export function isStrokeInRect(stroke: StrokeData, rect: { x: number, y: number, width: number, height: number }): boolean {
  const { points } = stroke;
  if (points.length === 0) return false;

  // Handle negative width/height by normalizing rect
  const rX = rect.width < 0 ? rect.x + rect.width : rect.x;
  const rY = rect.height < 0 ? rect.y + rect.height : rect.y;
  const rW = Math.abs(rect.width);
  const rH = Math.abs(rect.height);

  let pointsInside = 0;
  for (const p of points) {
    if (p.x >= rX && p.x <= rX + rW && p.y >= rY && p.y <= rY + rH) {
      pointsInside++;
    }
  }

  return (pointsInside / points.length) >= 0.4;
}

/**
 * Returns true if the stroke intersects with the selection box (even partially).
 * Uses simple AABB intersection.
 */
export function isStrokeIntersectingRect(stroke: StrokeData, rect: { x: number, y: number, width: number, height: number }): boolean {
  const bounds = getStrokesBoundingBox([stroke]);
  if (!bounds) return false;

  const rX = rect.width < 0 ? rect.x + rect.width : rect.x;
  const rY = rect.height < 0 ? rect.y + rect.height : rect.y;
  const rW = Math.abs(rect.width);
  const rH = Math.abs(rect.height);

  // Check AABB intersection
  return (bounds.minX < rX + rW &&
    bounds.maxX > rX &&
    bounds.minY < rY + rH &&
    bounds.maxY > rY);
}

/**
 * Returns true if a point is inside the given rectangle bounds.
 */
export function isPointInRect(point: { x: number, y: number }, rect: { minX: number, minY: number, maxX: number, maxY: number }): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

/**
 * Calculates the bounding box of a set of strokes.
 */
export function getStrokesBoundingBox(strokes: StrokeData[]): { minX: number, minY: number, maxX: number, maxY: number } | null {
  if (strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let maxStrokeWidth = 0;
  let hasPoints = false;

  for (const stroke of strokes) {
    if (stroke.text !== undefined) {
      // HANDLE TEXT - Calculate dimensions dynamically
      if (stroke.points.length > 0) {
        hasPoints = true;
        const p = stroke.points[0];
        const fontSize = p.size || 20;

        const { width: w, height: h } = measureTextDimensions(stroke.text, fontSize);

        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + w > maxX) maxX = p.x + w;
        if (p.y + h > maxY) maxY = p.y + h;
      }
    } else {
      // HANDLE NORMAL STROKES
      for (const p of stroke.points) {
        hasPoints = true;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.size > maxStrokeWidth) maxStrokeWidth = p.size;
      }
    }
  }

  if (!hasPoints) return null;

  // Add padding: Half the max stroke width (to cover the stroke thickness) + 5px visual clearance
  const padding = (maxStrokeWidth / 2) + 5;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding
  };
}
/**
 * Returns the resize handle that was hit, or null.
 * Handles: 'nw', 'ne', 'sw', 'se'
 */
export function hitTestResizeHandle(point: { x: number, y: number }, bounds: { minX: number, minY: number, maxX: number, maxY: number }, zoom: number): 'nw' | 'ne' | 'sw' | 'se' | null {
  const handleSize = 8 / zoom;
  const halfHandle = handleSize / 2;
  const tolerance = handleSize; // generous hit area

  const check = (x: number, y: number) => {
    return Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance;
  }

  // Corners (visual positions are shifted by half handle size, but we check center/corner)
  // Actually in DrawingLayer we render: x={minX - 4/zoom} ...
  // So center of handle is at minX, minY.

  if (check(bounds.minX, bounds.minY)) return 'nw';
  if (check(bounds.maxX, bounds.minY)) return 'ne';
  if (check(bounds.maxX, bounds.maxY)) return 'se';
  if (check(bounds.minX, bounds.maxY)) return 'sw';

  return null;
}
