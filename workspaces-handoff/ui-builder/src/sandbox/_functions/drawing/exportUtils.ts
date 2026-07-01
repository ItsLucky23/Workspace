
import { StrokeData } from "src/sandbox/_providers/DrawingContextProvider";
import { getStroke } from 'perfect-freehand'
import { getSvgPathFromStroke } from './getSvgPathFromStroke'
import { getStrokesBoundingBox } from './selectionUtils'

// Shared options for getStroke to ensure consistent rendering
const getStrokeOptions = (pointSize: number) => ({
  size: Math.min(20, 12) * (pointSize / 10),
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => t,
  last: true,
});

// Shared bounds logic
const calculateViewBox = (strokes: StrokeData[], customBounds?: { x: number, y: number, width: number, height: number }) => {
  if (customBounds) {
    return {
      minX: customBounds.x,
      minY: customBounds.y,
      width: customBounds.width,
      height: customBounds.height
    };
  }

  const bounds = getStrokesBoundingBox(strokes);
  if (!bounds) return null;

  return {
    minX: bounds.minX,
    minY: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  };
}

export const downloadSvg = (strokes: StrokeData[], customBounds?: { x: number, y: number, width: number, height: number }) => {
  if (strokes.length === 0) return;

  const viewBox = calculateViewBox(strokes, customBounds);
  if (!viewBox) return;

  // 2. Generate SVG Content
  let svgContent = `<svg viewBox="${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}" xmlns="http://www.w3.org/2000/svg" style="background-color: transparent;">`;

  strokes.forEach(s => {
    if (s.points.length > 0) {
      // Freehand / Shape
      const stroke = getStroke(s.points, getStrokeOptions(s.points[0].size))
      const pathData = getSvgPathFromStroke(stroke)

      // Fill
      if (s.fill) {
        const fillPath = `M ${s.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
        svgContent += `<path d="${fillPath}" fill="${s.fill}" stroke="none" />`;
      }

      // Stroke
      svgContent += `<path d="${pathData}" fill="${s.points[0].color}" stroke="none" />`;
    }
  });

  svgContent += `</svg>`;

  // 3. Trigger Download
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, 'drawing.svg');
  URL.revokeObjectURL(url);
}

export const downloadPng = (strokes: StrokeData[], customBounds?: { x: number, y: number, width: number, height: number }) => {
  if (strokes.length === 0) return;

  const viewBox = calculateViewBox(strokes, customBounds);
  if (!viewBox) return;

  // Generate SVG string
  let svgContent = `<svg viewBox="${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}" xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}">`;

  strokes.forEach(s => {
    if (s.points.length > 0) {
      const stroke = getStroke(s.points, getStrokeOptions(s.points[0].size))
      const pathData = getSvgPathFromStroke(stroke)

      if (s.fill) {
        const fillPath = `M ${s.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
        svgContent += `<path d="${fillPath}" fill="${s.fill}" stroke="none" />`;
      }

      svgContent += `<path d="${pathData}" fill="${s.points[0].color}" stroke="none" />`;
    }
  });
  svgContent += `</svg>`;

  const img = new Image();
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = viewBox.width;
    canvas.height = viewBox.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const pngUrl = canvas.toDataURL('image/png');
      triggerDownload(pngUrl, 'drawing.png');
    }
    URL.revokeObjectURL(url);
  };

  img.src = url;
}

const triggerDownload = (url: string, filename: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
