
import { StrokeData, DrawingPoint } from "src/sandbox/_providers/DrawingContextProvider";

type Rect = { x: number, y: number, width: number, height: number };

/**
 * Clips a single segment (p1 -> p2) against a rectangle.
 * Returns null if strictly outside, or [start, end] points of the visible segment.
 * Note: simplistic Sutherland-Hodgman or Cohen-Sutherland approach for a single segment.
 */
function clipSegment(p1: DrawingPoint, p2: DrawingPoint, rect: Rect): [DrawingPoint, DrawingPoint] | null {
  let x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const minX = Math.min(rect.x, rect.x + rect.width);
  const maxX = Math.max(rect.x, rect.x + rect.width);
  const minY = Math.min(rect.y, rect.y + rect.height);
  const maxY = Math.max(rect.y, rect.y + rect.height);

  const INSIDE = 0; // 0000
  const LEFT = 1;   // 0001
  const RIGHT = 2;  // 0010
  const BOTTOM = 4; // 0100
  const TOP = 8;    // 1000

  const computeOutCode = (x: number, y: number) => {
    let code = INSIDE;
    if (x < minX) code |= LEFT;
    else if (x > maxX) code |= RIGHT;
    if (y < minY) code |= TOP; // Note: Ensure Y coordinates match system (Top < Bottom?) Usually screen coords: Top is smaller Y.
    // Wait, in standard math Y goes up. In screen, Y goes down.
    // If Y goes down (0 at top), then "Top" of rect (visually) is minY. 
    // If y < minY, it is ABOVE the rect. In code names, this is often called TOP or BOTTOM depending on convention.
    // Let's stick to numerical checks.
    // y < minY -> "Above" (Top)
    else if (y > maxY) code |= BOTTOM; // "Below"
    return code;
  };

  let outcode1 = computeOutCode(x1, y1);
  let outcode2 = computeOutCode(x2, y2);
  let accept = false;

  while (true) {
    if (!(outcode1 | outcode2)) {
      // Bitwise OR is 0. Trivially accept and exit.
      accept = true;
      break;
    } else if (outcode1 & outcode2) {
      // Bitwise AND is not 0. Trivially reject and exit.
      break;
    } else {
      // Failed both tests, so calculate the line segment to clip
      // from an outside point to an intersection with clip edge
      let x = 0, y = 0;

      // At least one endpoint is outside the clip rectangle; pick it.
      const outcodeOut = outcode1 ? outcode1 : outcode2;

      // Find intersection point;
      // using formulas y = y1 + slope * (x - x1), x = x1 + (1 / slope) * (y - y1)
      if (outcodeOut & BOTTOM) {           // point is below the clip rect
        x = x1 + (x2 - x1) * (maxY - y1) / (y2 - y1);
        y = maxY;
      } else if (outcodeOut & TOP) { // point is above the clip rect
        x = x1 + (x2 - x1) * (minY - y1) / (y2 - y1);
        y = minY;
      } else if (outcodeOut & RIGHT) {  // point is to the right of clip rect
        y = y1 + (y2 - y1) * (maxX - x1) / (x2 - x1);
        x = maxX;
      } else if (outcodeOut & LEFT) {   // point is to the left of clip rect
        y = y1 + (y2 - y1) * (minX - x1) / (x2 - x1);
        x = minX;
      }

      // Now we move outside point to intersection point to clip
      // and ready for next pass.
      if (outcodeOut === outcode1) {
        x1 = x; y1 = y;
        outcode1 = computeOutCode(x1, y1);
      } else {
        x2 = x; y2 = y;
        outcode2 = computeOutCode(x2, y2);
      }
    }
  }

  if (accept) {
    // Interpolate attributes (size, color)
    // Simple linear interpolation based on distance ratio?
    // Or just inherit from p1/p2.
    // For 'perfect-freehand', color/size per point matters.
    // We'll just clone p1 props for start, p2 props for end for simplicity, 
    // or better: interpolate size.

    // Accurate approach:
    // If x1 != p1.x, x1 is an intersection.
    // We construct new points.

    const newP1 = { ...p1, x: x1, y: y1 };
    const newP2 = { ...p2, x: x2, y: y2 };

    // We should strictly interpolate size if possible, to avoid "popping" thickness.
    const distTotal = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const dist1 = Math.hypot(x1 - p1.x, y1 - p1.y);
    const dist2 = Math.hypot(x2 - p1.x, y2 - p1.y);

    if (distTotal > 0) {
      newP1.size = p1.size + (p2.size - p1.size) * (dist1 / distTotal);
      newP2.size = p1.size + (p2.size - p1.size) * (dist2 / distTotal);
    }

    return [newP1, newP2];
  }

  return null;
}

export function clipStrokesToRect(strokes: StrokeData[], rect: Rect): StrokeData[] {
  const finalStrokes: StrokeData[] = [];

  strokes.forEach(stroke => {
    // Optimization: Intersect bounding box first? 
    // We already have hit testing for that, but let's just do point by point.

    if (stroke.points.length < 2) {
      // Single point: check point in rect
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        if (p.x >= rect.x && p.x <= rect.x + rect.width &&
          p.y >= rect.y && p.y <= rect.y + rect.height) {
          finalStrokes.push(stroke);
        }
      }
      return;
    }

    let currentPoints: DrawingPoint[] = [];

    for (let i = 0; i < stroke.points.length - 1; i++) {
      const p1 = stroke.points[i];
      const p2 = stroke.points[i + 1];

      const clipped = clipSegment(p1, p2, rect);

      if (clipped) {
        const [c1, c2] = clipped;

        // If currentPoints is empty, start new strip
        if (currentPoints.length === 0) {
          currentPoints.push(c1);
        } else {
          // Check continuity. 
          // If last point of current strip is same as c1 (visual equality or microscopic tolerance)
          const last = currentPoints[currentPoints.length - 1];
          if (Math.abs(last.x - c1.x) < 0.001 && Math.abs(last.y - c1.y) < 0.001) {
            // connected
          } else {
            // Discontinuity (gap bridged by outside segment, but we shouldn't bridge it)
            // Wait, if we are here, clipSegment returned a segment efficiently.
            // If there was a gap, clipSegment would have returned different coordinates?
            // Actually, if we skip an "outside" segment, we enter this block with a NEW c1.
            // So we must flush currentPoints to a stroke and start new.

            // Case: p1-p2 IN. p2-p3 OUT. p3-p4 IN.
            // i=0: p1-p2 -> c1=p1, c2=p2. currentPoints: [p1, p2].
            // i=1: p2-p3 -> null (outside). Loop continues.
            // i=2: p3-p4 -> c1=p3, c2=p4. 
            // currentPoints has [p1, p2].
            // We check last (p2) vs c1 (p3). Dist > 0.
            // This is a GAP.
            // So we must save [p1, p2] as a stroke and start new [p3...].

            // Add stroke
            if (currentPoints.length > 0) {
              // Don't add if single point? (Unless dots)
              // Drawing needs at least 1 point (rendered as dot) or 2?
              finalStrokes.push({
                ...stroke,
                id: crypto.randomUUID(),
                points: [...currentPoints]
              });
            }
            currentPoints = [c1];
          }
        }

        // Add end point
        currentPoints.push(c2);

      } else {
        // Segment fully outside.
        // If we have accumulated points, we effectively "cut" here.
        if (currentPoints.length > 0) {
          finalStrokes.push({
            ...stroke,
            id: crypto.randomUUID(),
            points: [...currentPoints]
          });
          currentPoints = [];
        }
      }
    }

    // Flush remaining
    if (currentPoints.length > 0) {
      finalStrokes.push({
        ...stroke,
        id: crypto.randomUUID(), // New ID to avoid conflicts
        points: [...currentPoints]
      });
    }
  });

  return finalStrokes;
}
