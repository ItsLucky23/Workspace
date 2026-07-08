//? B1 — pure crop/resize geometry for the ImageEditor. Kept provider- and Fabric-free so the math is
//? unit-tested without a canvas: `clampCropRegion` turns a (possibly out-of-bounds / inverted) selection
//? rectangle into an integer sub-region clamped to the canvas, and `resizeDimensions` maps a preset target
//? width to a proportional height. The editor feeds these into Fabric's `toDataURL({left,top,width,height})`
//? + an offscreen resize.

export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

//? Clamp an arbitrary selection rectangle (any origin, possibly negative width/height, possibly spilling
//? outside the canvas) to an integer region fully inside [0..canvasW]×[0..canvasH]. Returns null when the
//? clamped region is degenerate (< 2px on a side) so the caller falls back to "no crop".
export function clampCropRegion(rect: CropRegion, canvasW: number, canvasH: number): CropRegion | null {
  const rx1 = Math.min(rect.left, rect.left + rect.width);
  const ry1 = Math.min(rect.top, rect.top + rect.height);
  const rx2 = Math.max(rect.left, rect.left + rect.width);
  const ry2 = Math.max(rect.top, rect.top + rect.height);
  const x1 = Math.max(0, Math.min(rx1, canvasW));
  const y1 = Math.max(0, Math.min(ry1, canvasH));
  const x2 = Math.max(0, Math.min(rx2, canvasW));
  const y2 = Math.max(0, Math.min(ry2, canvasH));
  const width = Math.round(x2 - x1);
  const height = Math.round(y2 - y1);
  if (width < 2 || height < 2) return null;
  return { left: Math.round(x1), top: Math.round(y1), width, height };
}

//? Map a source size to a preset target width, preserving aspect ratio. A null/zero target (or one that
//? would upscale) leaves the size unchanged — resize only ever shrinks.
export function resizeDimensions(width: number, height: number, targetWidth: number | null): { width: number; height: number } {
  if (targetWidth === null || targetWidth <= 0 || targetWidth >= width) return { width: Math.round(width), height: Math.round(height) };
  const ratio = targetWidth / width;
  return { width: Math.round(targetWidth), height: Math.max(1, Math.round(height * ratio)) };
}

//? The resize presets offered in the editor (max output width in px; null = keep original).
export const RESIZE_PRESETS: { key: string; width: number | null }[] = [
  { key: 'original', width: null },
  { key: 'w1080', width: 1080 },
  { key: 'w720', width: 720 },
  { key: 'w512', width: 512 },
];
