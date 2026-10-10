export interface CursorPoint { x: number; y: number }

export function cursorBend(source: CursorPoint, target: CursorPoint, cursor: CursorPoint | null, zoom = 1) {
  const middle = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
  const control = { ...middle }
  const dx = target.x - source.x, dy = target.y - source.y
  const length = Math.hypot(dx, dy)
  if (cursor && length && zoom > 0) {
    const t = Math.max(0, Math.min(1, ((cursor.x - source.x) * dx + (cursor.y - source.y) * dy) / (length * length)))
    const distance = Math.hypot(cursor.x - source.x - dx * t, cursor.y - source.y - dy * t) * zoom
    const influence = Math.max(0, 1 - distance / 180) ** 2 * 4 * t * (1 - t)
    const perpendicular = ((cursor.x - middle.x) * -dy + (cursor.y - middle.y) * dx) / length * zoom
    // The quadratic curve moves halfway toward its control point: at most 10 screen pixels.
    const pull = Math.max(-20, Math.min(20, perpendicular * .4)) * influence / zoom
    control.x += -dy / length * pull
    control.y += dx / length * pull
  }
  return {
    path: `M ${source.x},${source.y} Q ${control.x},${control.y} ${target.x},${target.y}`,
    labelX: middle.x + (control.x - middle.x) / 2,
    labelY: middle.y + (control.y - middle.y) / 2,
  }
}
