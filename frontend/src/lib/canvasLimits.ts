export function canvasLimits(points: { x: number; y: number }[], nodeWidth: number, nodeHeight: number, width: number, height: number) {
  const left = Math.min(0, ...points.map(p => p.x))
  const top = Math.min(0, ...points.map(p => p.y))
  const right = Math.max(0, ...points.map(p => p.x)) + nodeWidth
  const bottom = Math.max(0, ...points.map(p => p.y)) + nodeHeight
  const minZoom = Math.max(.01, Math.min(1, width / ((right - left) * 1.5), height / ((bottom - top) * 1.5)))
  // Enough room to focus edge nodes, while keeping the graph within a bounded world.
  const xPad = Math.max(240, width / 1.5), yPad = Math.max(200, height / 1.5)
  const extent: [[number, number], [number, number]] = [[left - xPad, top - yPad], [right + xPad, bottom + yPad]]
  return { minZoom, extent }
}
