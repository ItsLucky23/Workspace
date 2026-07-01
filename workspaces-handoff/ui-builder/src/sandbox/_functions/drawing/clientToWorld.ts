export const clientToWorld = (
  clientX: number,
  clientY: number,
  overlayEl: SVGSVGElement | null,
  offset: { x: number, y: number },
  zoom: number
) => {
  if (!overlayEl) return { x: 0, y: 0 }
  const rect = overlayEl.getBoundingClientRect()
  const screenX = clientX - rect.left
  const screenY = clientY - rect.top
  return {
    x: (screenX - offset.x) / zoom,
    y: (screenY - offset.y) / zoom,
  }
}
