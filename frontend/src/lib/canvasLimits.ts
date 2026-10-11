export function canvasLimits(points: { x: number; y: number }[], nodeWidth: number, nodeHeight: number, width: number, height: number) {
  const left = Math.min(0, ...points.map(p => p.x))
  const top = Math.min(0, ...points.map(p => p.y))
  const right = Math.max(0, ...points.map(p => p.x)) + nodeWidth
  const bottom = Math.max(0, ...points.map(p => p.y)) + nodeHeight
  const minZoom = Math.max(.01, Math.min(1, width / ((right - left) * 1.5), height / ((bottom - top) * 1.5)))
  // Tight bounds: panning stops just past the outermost nodes. The minimums
  // cover the selection camera's offset (focus sits a quarter-screen off the node).
  const xPad = 120 + width * .05, yPad = 100 + height * .05
  const extent: [[number, number], [number, number]] = [[left - xPad, top - yPad], [right + xPad, bottom + yPad]]
  return { minZoom, extent }
}
