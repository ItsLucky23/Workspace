/**
 * Shared utilities for drawing operations.
 * Consolidates duplicate geometry and text measurement logic.
 */

/**
 * Ray casting algorithm to check if a point is inside a polygon.
 * Used by fill tool and eraser on filled shapes.
 */
export const isPointInPolygon = (
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

/**
 * Measures the dimensions of text content using canvas.
 * Returns { width, height } for the text at given font size.
 */
export const measureTextDimensions = (
  text: string | undefined,
  fontSize: number
): { width: number; height: number } => {
  let width = 100;
  let height = fontSize * 1.5;

  if (text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${fontSize}px sans-serif`;
      const lines = text.split('\n');
      let maxWidth = 0;
      lines.forEach((line: string) => {
        const lineWidth = ctx.measureText(line).width;
        if (lineWidth > maxWidth) maxWidth = lineWidth;
      });
      width = Math.max(50, maxWidth + 20); // padding
      height = Math.max(fontSize * 1.5, lines.length * fontSize * 1.2 + 10);
    }
  }

  return { width, height };
};
