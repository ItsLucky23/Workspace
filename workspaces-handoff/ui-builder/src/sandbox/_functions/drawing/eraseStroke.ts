import { DrawingPoint, StrokeData } from "src/sandbox/_providers/DrawingContextProvider";
import { isPointInPolygon } from "./sharedUtils";

const notInRange = (stroke: StrokeData, x: number, y: number, radius: number) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  if (x + radius < minX || x - radius > maxX || y + radius < minY || y - radius > maxY) {
    return true;
  }
  return false;
}

export const eraseStokePoint = (
  x: number,
  y: number,
  brushSize: number,
  prevStrokes: StrokeData[]
): StrokeData[] | null => {
  const radius = brushSize / 2;
  const newStrokes: StrokeData[] = [];
  let changed = false;

  for (const stroke of prevStrokes) {
    // optimization: check bounding box first
    if (notInRange(stroke, x, y, radius)) {
      newStrokes.push(stroke);
      continue;
    }

    let currentSegment: DrawingPoint[] = [];
    let strokeModified = false;

    for (const p of stroke.points) {
      const dist = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2);
      if (dist > radius) {
        currentSegment.push(p);
      } else {
        strokeModified = true;
        changed = true;
        if (currentSegment.length > 1) {
          // Creates a new stroke, copy lineStyle but not fill
          // We intentionally remove fill when modifying/erasing part of a stroke (partial erase)
          newStrokes.push({ id: crypto.randomUUID(), points: currentSegment, lineStyle: stroke.lineStyle });
        }
        currentSegment = [];
      }
    }

    if (currentSegment.length > 1) {
      // if stroke was not modified at all, keep original id and properties
      newStrokes.push({
        id: strokeModified ? crypto.randomUUID() : stroke.id,
        points: currentSegment,
        fill: strokeModified ? undefined : stroke.fill,
        lineStyle: stroke.lineStyle
      });
    } else if (currentSegment.length <= 1 && !strokeModified) {
      // if original stroke was tiny and not touched
      if (stroke.points.length > 1) {
        newStrokes.push(stroke);
      }
    }
  }

  return changed ? newStrokes : null;
}

export const eraseStroke = (
  x: number,
  y: number,
  brushSize: number,
  prevStrokes: StrokeData[]
) => {
  const radius = brushSize / 2;
  const newStrokes: StrokeData[] = [];

  for (const stroke of prevStrokes) {
    //? Quick reject: mouse nowhere near bounding box
    if (notInRange(stroke, x, y, radius)) {
      newStrokes.push(stroke);
      continue;
    }

    //? Accuracy check: is any actual point near the eraser?
    let hit = false;
    for (const p of stroke.points) {
      const dist = Math.hypot(p.x - x, p.y - y); // cleaner distance
      if (dist <= radius) {
        hit = true;
        break;
      }
    }

    //? Check if inside fill (for filled shapes)
    if (!hit && stroke.fill && stroke.points.length > 2) {
      if (isPointInPolygon({ x, y }, stroke.points)) {
        hit = true;
      }
    }

    if (!hit) {
      //? Stroke wasn't actually touched, keep it
      newStrokes.push(stroke);
    }
    //? Otherwise: do NOT push → stroke is erased
  }

  return newStrokes;

}