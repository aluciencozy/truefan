import type { UniverseModel } from './universeModel.ts'
import type { Point, Positions } from './universeLayout.ts'
import { MEDIA_WIDTH } from './universeLayout.ts'

export function connectionDestination(link: { source: string; target: string }, focusedId: string): string {
  return link.target === focusedId ? link.source : link.target
}

export function connectedNeighbors(model: UniverseModel, id: string): string[] {
  return [...new Set(model.links.flatMap(link => link.source === id && link.target !== id ? [link.target]
    : link.target === id && link.source !== id ? [link.source] : []))]
}

/** Follow actual connections, preferring the neighbor most aligned with the pressed arrow. */
export function directionalNeighbor(id: string, neighbors: string[], positions: Positions, direction: Point): string | undefined {
  const origin = positions[id]
  if (!origin) return
  return neighbors.filter(other => positions[other]).map(other => {
    const dx = positions[other].x - origin.x, dy = positions[other].y - origin.y
    const distance = Math.hypot(dx, dy)
    return { id: other, alignment: distance ? (dx * direction.x + dy * direction.y) / distance : 0, distance }
  }).filter(item => item.alignment > .15)
    .sort((a, b) => b.alignment - a.alignment || a.distance - b.distance)[0]?.id
}

export function focusViewport(point: Point, width: number, height: number) {
  const compact = width < 500
  const zoom = compact ? .95 : Math.min(1.25, Math.max(1, width / 850))
  return { x: width * .5 - (point.x + MEDIA_WIDTH / 2) * zoom,
    y: height * .43 - (point.y + 50) * zoom, zoom }
}
