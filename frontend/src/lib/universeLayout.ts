import type { ElkNode } from 'elkjs'
import type { UniverseModel } from './universeModel.ts'

export const MEDIA_WIDTH = 176
export const MEDIA_HEIGHT = 174
// Includes the 235px focused artwork, labels, and a little breathing room.
export const WORLD_CLEARANCE = 300
export interface Point { x: number; y: number }
export type Positions = Record<string, Point>
export interface GroupBounds { id: string; label: string; x: number; y: number; width: number; height: number }

export function groupBounds(model: UniverseModel, positions: Positions): GroupBounds[] {
  return model.groups.flatMap(group => {
    const points = group.mediaIds.map(id => positions[id]).filter(Boolean)
    if (!points.length) return []
    const x = Math.min(...points.map(p => p.x)) - 60, y = Math.min(...points.map(p => p.y)) - 100
    return [{ id: group.id, label: group.label, x, y,
      width: Math.max(...points.map(p => p.x)) + MEDIA_WIDTH + 60 - x,
      height: Math.max(...points.map(p => p.y)) + MEDIA_HEIGHT + 100 - y }]
  })
}

function finishLayout(model: UniverseModel, proposed: Positions): Positions {
  const positions: Positions = {}
  let bottom: number | null = null
  for (const group of model.groups) {
    const placed: Point[] = []
    for (const id of group.mediaIds) {
      let seed = 2166136261
      for (const character of id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
      seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b)
      const point = { x: proposed[id].x + ((seed & 0xffff) / 65535 - .5) * 48,
        y: proposed[id].y + ((seed >>> 16) / 65535 - .5) * 84 }
      while (placed.some(p => Math.abs(p.x - point.x) < WORLD_CLEARANCE && Math.abs(p.y - point.y) < WORLD_CLEARANCE)) point.y += WORLD_CLEARANCE
      positions[id] = point; placed.push(point)
    }
    const bounds = groupBounds({ ...model, groups: [group] }, positions)[0]
    if (!bounds) continue
    const shift: number = bottom === null ? -bounds.y : bottom + 180 - bounds.y
    for (const id of group.mediaIds) positions[id].y += shift
    bottom = bounds.y + shift + bounds.height
  }
  return positions
}

function depths(model: UniverseModel): Map<string, number> {
  const parents = new Map(model.progression.map(link => [link.target, link.source]))
  const result = new Map<string, number>()
  const depth = (id: string): number => {
    if (result.has(id)) return result.get(id)!
    const parent = parents.get(id)
    const value = parent ? depth(parent) + 1 : 0
    result.set(id, value); return value
  }
  model.media.forEach(item => depth(item.id))
  return result
}

export function fallbackPositions(model: UniverseModel): Positions {
  const ranks = depths(model), positions: Positions = {}
  for (const group of model.groups) {
    const rows = new Map<number, number>()
    for (const id of group.mediaIds) {
      const rank = ranks.get(id) ?? 0, row = rows.get(rank) ?? 0
      positions[id] = { x: rank * 420, y: row * 400 }
      rows.set(rank, row + 1)
    }
  }
  return finishLayout(model, positions)
}

export async function layoutUniverse(model: UniverseModel): Promise<Positions> {
  if (!model.media.length) return {}
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK(), ranks = depths(model)
  const layouts = await Promise.all(model.groups.map(group => elk.layout<ElkNode>({
    id: group.id,
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.randomSeed': '17',
      'elk.spacing.nodeNode': '220', 'elk.layered.spacing.nodeNodeBetweenLayers': '244',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: group.mediaIds.map(id => ({ id, width: MEDIA_WIDTH, height: MEDIA_HEIGHT })),
    edges: model.progression.filter(link => group.mediaIds.includes(link.source) && group.mediaIds.includes(link.target))
      .map(link => ({ id: link.id, sources: [link.source], targets: [link.target] })),
  })))
  const positions: Positions = {}
  for (const layout of layouts) for (const node of layout.children ?? []) {
    positions[node.id] = { x: Math.max(node.x ?? 0, (ranks.get(node.id) ?? 0) * 420), y: node.y ?? 0 }
  }
  return finishLayout(model, positions)
}

/** Rebalance around the focused world so growth never moves it on screen. */
export function anchorLayout(proposed: Positions, previous: Positions, focusedId: string): Positions {
  if (!proposed[focusedId] || !previous[focusedId]) return proposed
  const dx = previous[focusedId].x - proposed[focusedId].x, dy = previous[focusedId].y - proposed[focusedId].y
  return Object.fromEntries(Object.entries(proposed).map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]))
}
