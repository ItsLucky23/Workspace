import { getStroke } from 'perfect-freehand'
import { getSvgPathFromStroke } from './getSvgPathFromStroke'
import { DrawingPoint, LineStyle } from 'src/sandbox/_providers/DrawingContextProvider'

export const RenderDrawingPath = ({ points, zoom, fill, strokeData }: { points: DrawingPoint[], zoom: number, fill?: string, strokeData?: { lineStyle?: LineStyle, text?: string } }) => {
  // If it's a text stroke, we don't render it here (handled in DrawingLayer)
  if (strokeData?.text !== undefined) return null;

  const lineStyle = strokeData?.lineStyle || 'solid';

  // For dashed/dotted, render as a stroke-based line instead of filled path
  if (lineStyle !== 'solid') {
    // Create a simple polyline path from center points
    const linePath = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
    // Use the brush size directly for stroke width
    const strokeWidth = points[0].size;
    // Make dash array proportional to stroke width for visibility
    const strokeDasharray = lineStyle === 'dashed'
      ? `${strokeWidth * 4} ${strokeWidth * 2}`   // Long dashes with medium gaps
      : `${strokeWidth * 0.1} ${strokeWidth * 2}`; // Tiny dots with large gaps

    return (
      <>
        {fill && <path d={linePath + ' Z'} fill={fill} stroke="none" />}
        <path
          d={linePath}
          fill="none"
          stroke={points[0].color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  }

  // Solid style - use perfect-freehand for smooth filled paths
  const stroke = getStroke(points, {
    size: Math.min(20, (12 / zoom)) * (points[0].size / 10),
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t: number) => t,
    last: true,
  })
  const pathData = getSvgPathFromStroke(stroke)

  // Create fill path from center points
  const fillPath = fill ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')} Z` : undefined;

  return (
    <>
      {fill && <path d={fillPath} fill={fill} stroke="none" />}
      <path d={pathData} fill={points[0].color} stroke="none" />
    </>
  )
}
