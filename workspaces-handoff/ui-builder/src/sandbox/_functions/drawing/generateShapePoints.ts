import { DrawingPoint, ShapeType } from "src/sandbox/_providers/DrawingContextProvider";

export function generateShapePoints(
  start: { x: number, y: number },
  end: { x: number, y: number },
  shapeType: ShapeType,
  brushSize: number,
  color: string
): DrawingPoint[] {
  const points: DrawingPoint[] = [];
  // Use a higher density step to smooth out shapes and ensure corners are good.
  // Previously: Math.max(1, brushSize / 4).
  // New: Math.max(1, brushSize / 10) ensures at least 10 "stamps" per brush diameter.
  const step = Math.max(1, brushSize / 10);

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const width = maxX - minX;
  const height = maxY - minY;

  const addPoint = (x: number, y: number) => {
    points.push({ x, y, color, size: brushSize });
  };

  if (shapeType === 'square') {
    // We use interpolation for edges to guarantee we hit the corners exactly,
    // regardless of whether the side length is divisible by the step size.

    // Top edge (minX, minY) -> (maxX, minY)
    const distTop = width;
    const stepsTop = Math.max(1, Math.ceil(distTop / step));
    for (let i = 0; i <= stepsTop; i++) {
      const t = i / stepsTop;
      addPoint(minX + (maxX - minX) * t, minY);
    }

    // Right edge (maxX, minY) -> (maxX, maxY)
    const distRight = height;
    const stepsRight = Math.max(1, Math.ceil(distRight / step));
    for (let i = 0; i <= stepsRight; i++) {
      const t = i / stepsRight;
      addPoint(maxX, minY + (maxY - minY) * t);
    }

    // Bottom edge (maxX, maxY) -> (minX, maxY)
    // Note: iterating backwards or just swapping start/end logic
    const distBottom = width;
    const stepsBottom = Math.max(1, Math.ceil(distBottom / step));
    for (let i = 0; i <= stepsBottom; i++) {
      const t = i / stepsBottom;
      addPoint(maxX - (maxX - minX) * t, maxY);
    }

    // Left edge (minX, maxY) -> (minX, minY)
    const distLeft = height;
    const stepsLeft = Math.max(1, Math.ceil(distLeft / step));
    for (let i = 0; i <= stepsLeft; i++) {
      const t = i / stepsLeft;
      addPoint(minX, maxY - (maxY - minY) * t);
    }

  } else if (shapeType === 'circle') {
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;
    const radiusX = width / 2;
    const radiusY = height / 2;

    // Circumference approximation to determine steps
    const circumference = 2 * Math.PI * Math.sqrt((radiusX * radiusX + radiusY * radiusY) / 2);
    // Ensure accurate curvature even for small circles with large brushes
    const steps = Math.max(10, Math.ceil(circumference / step));

    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * 2 * Math.PI;
      const x = centerX + radiusX * Math.cos(theta);
      const y = centerY + radiusY * Math.sin(theta);
      addPoint(x, y);
    }
  } else if (shapeType === 'diamond') {
    const midX = minX + width / 2;
    const midY = minY + height / 2;

    // Top to Right
    const d1 = Math.sqrt(Math.pow(maxX - midX, 2) + Math.pow(midY - minY, 2));
    const steps1 = Math.max(1, Math.ceil(d1 / step));
    for (let i = 0; i <= steps1; i++) {
      const t = i / steps1;
      addPoint(midX + (maxX - midX) * t, minY + (midY - minY) * t);
    }

    // Right to Bottom
    const d2 = Math.sqrt(Math.pow(midX - maxX, 2) + Math.pow(maxY - midY, 2));
    const steps2 = Math.max(1, Math.ceil(d2 / step));
    for (let i = 0; i <= steps2; i++) {
      const t = i / steps2;
      addPoint(maxX + (midX - maxX) * t, midY + (maxY - midY) * t);
    }

    // Bottom to Left
    const d3 = Math.sqrt(Math.pow(minX - midX, 2) + Math.pow(midY - maxY, 2));
    const steps3 = Math.max(1, Math.ceil(d3 / step));
    for (let i = 0; i <= steps3; i++) {
      const t = i / steps3;
      addPoint(midX + (minX - midX) * t, maxY + (midY - maxY) * t);
    }

    // Left to Top
    const d4 = Math.sqrt(Math.pow(midX - minX, 2) + Math.pow(minY - midY, 2));
    const steps4 = Math.max(1, Math.ceil(d4 / step));
    for (let i = 0; i <= steps4; i++) {
      const t = i / steps4;
      addPoint(minX + (midX - minX) * t, midY + (minY - midY) * t);
    }
  } else if (shapeType === 'line') {
    const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      addPoint(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
    }
  } else if (shapeType === 'arrow') {
    // 1. Draw shaft (Start -> End)
    const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      addPoint(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
    }

    // 2. Draw Arrowhead
    // Angle of the line
    const angle = Math.atan2(end.y - start.y, end.x - start.x);

    // Length of wings (approx 20% of length or capped min/max?)
    // Let's use a fixed reasonable size for predictability, scaled by brush size slightly
    const headLength = Math.min(dist / 3, 20 + brushSize * 2);
    const wingAngle = Math.PI / 6; // 30 degrees

    // Wing 1
    const x1 = end.x - headLength * Math.cos(angle - wingAngle);
    const y1 = end.y - headLength * Math.sin(angle - wingAngle);

    const distWing1 = Math.sqrt(Math.pow(end.x - x1, 2) + Math.pow(end.y - y1, 2));
    const stepsWing1 = Math.max(1, Math.ceil(distWing1 / step));
    for (let i = 0; i <= stepsWing1; i++) {
      const t = i / stepsWing1;
      // From End to x1,y1
      addPoint(end.x + (x1 - end.x) * t, end.y + (y1 - end.y) * t);
    }

    // Wing 2
    const x2 = end.x - headLength * Math.cos(angle + wingAngle);
    const y2 = end.y - headLength * Math.sin(angle + wingAngle);

    const distWing2 = Math.sqrt(Math.pow(end.x - x2, 2) + Math.pow(end.y - y2, 2));
    const stepsWing2 = Math.max(1, Math.ceil(distWing2 / step));
    for (let i = 0; i <= stepsWing2; i++) {
      const t = i / stepsWing2;
      // From End to x2,y2
      addPoint(end.x + (x2 - end.x) * t, end.y + (y2 - end.y) * t);
    }
  }

  return points;
}
