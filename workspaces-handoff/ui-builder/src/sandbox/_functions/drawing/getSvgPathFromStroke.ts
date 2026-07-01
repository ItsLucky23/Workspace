export function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return ''
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(`${i === 0 ? 'M' : 'L'} ${x0.toFixed(2)} ${y0.toFixed(2)}`)
      if (i === arr.length - 1) acc.push(`Z`)
      return acc
    },
    [] as string[]
  )
  return d.join(' ')
}
