
import { StrokeData } from "src/sandbox/_providers/DrawingContextProvider";
import { getStrokesBoundingBox } from "./selectionUtils";

export type SnappingGuide = {
  type: 'horizontal' | 'vertical' | 'gap-horizontal' | 'gap-vertical';
  orientation: 'horizontal' | 'vertical';
  position: number; // For line guides
  start: number;
  end: number;
  gapSize?: number; // For gap guides
};

/**
 * Calculates snapping offsets and guides for a moving set of objects.
 */
export function getSnappingGuides(
  movingStrokes: StrokeData[],
  otherStrokes: StrokeData[],
  dragOffset: { x: number, y: number },
  zoom: number
): { dx: number, dy: number, guides: SnappingGuide[] } {

  const SNAP_THRESHOLD = 8 / zoom; // Slightly larger threshold for better feel

  // 1. Calculate bounding box of moving strokes with current dragOffset
  const initialBounds = getStrokesBoundingBox(movingStrokes);
  if (!initialBounds) return { dx: dragOffset.x, dy: dragOffset.y, guides: [] };

  const currentBounds = {
    minX: initialBounds.minX + dragOffset.x,
    minY: initialBounds.minY + dragOffset.y,
    maxX: initialBounds.maxX + dragOffset.x,
    maxY: initialBounds.maxY + dragOffset.y,
    centerX: initialBounds.minX + dragOffset.x + (initialBounds.maxX - initialBounds.minX) / 2,
    centerY: initialBounds.minY + dragOffset.y + (initialBounds.maxY - initialBounds.minY) / 2,
    width: initialBounds.maxX - initialBounds.minX,
    height: initialBounds.maxY - initialBounds.minY
  };

  const movingPoints = {
    left: currentBounds.minX,
    right: currentBounds.maxX,
    top: currentBounds.minY,
    bottom: currentBounds.maxY,
    centerX: currentBounds.centerX,
    centerY: currentBounds.centerY
  };

  // 2. Identify candidate snap lines AND gap intervals from other strokes
  const candidatesX: number[] = [];
  const candidatesY: number[] = [];

  // Store bounds for gap analysis
  const otherBounds: { minX: number, maxX: number, minY: number, maxY: number, centerX: number, centerY: number }[] = [];

  for (const s of otherStrokes) {
    const b = getStrokesBoundingBox([s]);
    if (b) {
      candidatesX.push(b.minX, b.maxX, b.minX + (b.maxX - b.minX) / 2);
      candidatesY.push(b.minY, b.maxY, b.minY + (b.maxY - b.minY) / 2);
      otherBounds.push({
        minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY,
        centerX: b.minX + (b.maxX - b.minX) / 2,
        centerY: b.minY + (b.maxY - b.minY) / 2
      });
    }
  }

  // 3. Find closest snaps (Alignment)
  let snapDx = 0;
  let snapDy = 0;
  let minDistX = SNAP_THRESHOLD;
  let minDistY = SNAP_THRESHOLD;
  const guides: SnappingGuide[] = [];

  // --- Alignment Snapping ---

  // Snap X
  for (const targetX of candidatesX) {
    const checkX = (current: number) => {
      const d = targetX - current;
      if (Math.abs(d) < minDistX) { minDistX = Math.abs(d); snapDx = d; }
    };
    checkX(movingPoints.left);
    checkX(movingPoints.right);
    checkX(movingPoints.centerX);
  }

  // Snap Y
  for (const targetY of candidatesY) {
    const checkY = (current: number) => {
      const d = targetY - current;
      if (Math.abs(d) < minDistY) { minDistY = Math.abs(d); snapDy = d; }
    };
    checkY(movingPoints.top);
    checkY(movingPoints.bottom);
    checkY(movingPoints.centerY);
  }

  // --- Gap Snapping ---
  // Only check if we haven't found a strong alignment snap, OR try to combine?
  // Usually Gap snapping is subtle. Let's prioritize alignment, but if alignment is loose, check gaps.
  // Actually, gap snapping should also adjust snapDx/snapDy.

  // We look for gaps between 'moving' and 'A', matching gap between 'A' and 'B'.

  // Horizontal Gaps
  // We need to sort objects by X to find neighbors? Not strict, but helps.
  // Brute force: match (Moving <-> A) distance to (A <-> B) distance.

  let gapSnapDx = 0;
  let gapSnapDy = 0;
  let minGapDistX = SNAP_THRESHOLD;
  let minGapDistY = SNAP_THRESHOLD;

  if (minDistX === SNAP_THRESHOLD) { // Only try gap snap if no strong alignment snap
    // Look for X gaps
    // 1. Moving is Right of A: Gap = Moving.Left - A.Right. Match with A.Left - B.Right?
    // 2. Moving is Left of A: Gap = A.Left - Moving.Right.

    for (const A of otherBounds) {
      // Check gaps between A and other B's
      // We only care about X gaps if they are vertically aligned (loosely) ?
      // For simplicity, just check pure X projection gaps first, or require overlap in Y?
      // Standard design tools usually require some overlap in orthogonal axis.
      const isVerticallyOverlapping = (Math.max(currentBounds.minY, A.minY) < Math.min(currentBounds.maxY, A.maxY));

      if (!isVerticallyOverlapping) continue;

      // Case 1: Moving is on the Right of A ( A [gap] Moving )
      // We want Gap(A, Moving) == Gap(B, A)
      // => Moving.Left - A.Right == A.Left - B.Right
      // => Moving.Left = A.Right + (A.Left - B.Right)

      for (const B of otherBounds) {
        if (A === B) continue;
        const isVerticallyOverlappingB = (Math.max(A.minY, B.minY) < Math.min(A.maxY, B.maxY));
        if (!isVerticallyOverlappingB) continue;

        // If B is left of A ( B [gap] A )
        if (B.maxX < A.minX) {
          const existingGap = A.minX - B.maxX;
          const targetLeft = A.maxX + existingGap;
          const diff = targetLeft - movingPoints.left; // Adjust moving so Left hits target

          if (Math.abs(diff) < minGapDistX) {
            minGapDistX = Math.abs(diff);
            gapSnapDx = diff;
            // Don't add guide yet, wait for best.
          }
        }
        // If B is right of A ( A [gap] B ) -> We want Moving [gap] A ?? No, logic usually implies sequence.
        // If we are placing Moving to the Left of A: Moving [gap] A. Match B [gap] A? (i.e. B is Left of A too?)
        // Or A [gap] B?
        // Let's simplified: Check if Moving is placing itself such that it creates a gap equal to ANY existing gap between X-neighbors A and B.
      }
    }

    // Also Handle explicit "Gap of 10" mentioned by user?
    // "when having a gap of 10 and than getting a third object it should be able to also snap... when it has a gap to one of the items with a gap of 10"
    // This confirms detecting existing gaps.
  }

  // Simplified Gap Search for X (Optimized)
  // Find all horizontal gaps between existing objects A and B.
  const existingXGaps: number[] = [];
  // For every pair A, B where OverlapY, calculate gap.
  for (let i = 0; i < otherBounds.length; i++) {
    for (let j = i + 1; j < otherBounds.length; j++) {
      const A = otherBounds[i];
      const B = otherBounds[j];
      if (Math.max(A.minY, B.minY) < Math.min(A.maxY, B.maxY)) { // Overlap Y
        const gap1 = A.minX - B.maxX; // B is left of A
        if (gap1 > 0) existingXGaps.push(gap1);
        const gap2 = B.minX - A.maxX; // A is left of B
        if (gap2 > 0) existingXGaps.push(gap2);
      }
    }
  }

  // Now check if Moving creates a matching gap with ANY A
  if (minDistX === SNAP_THRESHOLD) { // Only if no alignment
    for (const A of otherBounds) {
      if (Math.max(currentBounds.minY, A.minY) < Math.min(currentBounds.maxY, A.maxY)) { // Overlap Y
        // Check Moving to Right of A
        const currentGapRight = movingPoints.left - A.maxX;
        for (const g of existingXGaps) {
          if (Math.abs(currentGapRight - g) < minGapDistX) {
            minGapDistX = Math.abs(currentGapRight - g);
            gapSnapDx = g - currentGapRight; // Correction
          }
        }

        // Check Moving to Left of A
        const currentGapLeft = A.minX - movingPoints.right;
        for (const g of existingXGaps) {
          if (Math.abs(currentGapLeft - g) < minGapDistX) {
            minGapDistX = Math.abs(currentGapLeft - g);
            gapSnapDx = -(g - currentGapLeft); // Correction: move moving left (negative) to increase gap?
            // gap = A.minX - (Right + dx) = A.minX - Right - dx
            // We want gap == g
            // g = A.minX - Right - dx  =>  dx = A.minX - Right - g
            // Current Gap = A.minX - Right
            // dx = Current - g. 
            // Wait, if current is 12, g is 10. we want distance 10.
            // A.min - Right = 12. We want 10. We need to move Right by +2 (right). 
            // dx = 2.
            // dx = currentGap - g.
            gapSnapDx = currentGapLeft - g;
          }
        }
      }
    }
  }

  if (gapSnapDx !== 0 && Math.abs(gapSnapDx) < SNAP_THRESHOLD) {
    snapDx = gapSnapDx;
  }

  // Same logic for Y Gaps
  const existingYGaps: number[] = [];
  for (let i = 0; i < otherBounds.length; i++) {
    for (let j = i + 1; j < otherBounds.length; j++) {
      const A = otherBounds[i];
      const B = otherBounds[j];
      if (Math.max(A.minX, B.minX) < Math.min(A.maxX, B.maxX)) { // Overlap X
        const gap1 = A.minY - B.maxY;
        if (gap1 > 0) existingYGaps.push(gap1);
        const gap2 = B.minY - A.maxY;
        if (gap2 > 0) existingYGaps.push(gap2);
      }
    }
  }

  gapSnapDy = 0;
  if (minDistY === SNAP_THRESHOLD) {
    // FIX: Use the SNAPPED X position to check for vertical column overlap.
    // If we just snapped to an alignment guide in X, we are now "in the column".
    const snappedMinX = currentBounds.minX + snapDx;
    const snappedMaxX = currentBounds.maxX + snapDx;

    for (const A of otherBounds) {
      if (Math.max(snappedMinX, A.minX) < Math.min(snappedMaxX, A.maxX)) { // Overlap X (using snapped position)
        // Moving Below A (Top - A.Bottom)
        const currentGapBottom = movingPoints.top - A.maxY;
        for (const g of existingYGaps) {
          if (Math.abs(currentGapBottom - g) < minGapDistY) {
            // we want Gap == g
            // Gap = (Top + dy) - A.maxY
            // g = Top + dy - A.maxY
            // dy = g + A.maxY - Top 
            // = g - (Top - A.maxY) = g - currentGap
            gapSnapDy = g - currentGapBottom;
            minGapDistY = Math.abs(gapSnapDy);
          }
        }
        // Moving Above A (A.Top - Moving.Bottom)
        const currentGapTop = A.minY - movingPoints.bottom;
        for (const g of existingYGaps) {
          if (Math.abs(currentGapTop - g) < minGapDistY) {
            // Gap = A.minY - (Bottom + dy)
            // g = A.minY - Bottom - dy
            // dy = A.minY - Bottom - g
            // dy = currentGap - g
            gapSnapDy = currentGapTop - g;
            minGapDistY = Math.abs(gapSnapDy);
          }
        }
      }
    }
  }

  if (gapSnapDy !== 0 && Math.abs(gapSnapDy) < SNAP_THRESHOLD) {
    snapDy = gapSnapDy;
  }


  // 4. Generate Guides (Recalculate with final snap)
  const finalDx = dragOffset.x + snapDx;
  const finalDy = dragOffset.y + snapDy;

  // Re-verify alignment guides
  // ... (Simplification: just show guide if we snapped)
  if (snapDx !== 0) {
    // Find what we snapped to
    const finalLeft = movingPoints.left + snapDx;
    const finalRight = movingPoints.right + snapDx;
    const finalCenterX = movingPoints.centerX + snapDx;

    // Did we snap to a specific target?
    // Or was it a gap snap?
    // Visual feedback for gap snap is trickier (showing two gaps equal).
    // For alignment:

    // Check alignments again
    let aligned = false;
    for (const tx of candidatesX) {
      if (Math.abs(finalLeft - tx) < 0.01 || Math.abs(finalRight - tx) < 0.01 || Math.abs(finalCenterX - tx) < 0.01) {
        guides.push({ type: 'vertical', orientation: 'vertical', position: tx, start: -10000, end: 10000 });
        aligned = true;
      }
    }

    // If not aligned, it was a gap snap?
    if (!aligned) {
      // We can add "Gap" guides here later. For now, simple vertical line at edges to show 'something' happened?
      // Ideally we show arrows <-> 10px <->
    }
  }

  if (snapDy !== 0) {
    const finalTop = movingPoints.top + snapDy;
    const finalBottom = movingPoints.bottom + snapDy;
    const finalCenterY = movingPoints.centerY + snapDy;

    for (const ty of candidatesY) {
      if (Math.abs(finalTop - ty) < 0.01 || Math.abs(finalBottom - ty) < 0.01 || Math.abs(finalCenterY - ty) < 0.01) {
        guides.push({ type: 'horizontal', orientation: 'horizontal', position: ty, start: -10000, end: 10000 });
      }
    }
  }

  return {
    dx: finalDx,
    dy: finalDy,
    guides
  };
}
