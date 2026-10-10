import type { ElkNode } from 'elkjs'
import type { UniverseModel } from './universeModel.ts'

export const MEDIA_WIDTH = 176
export const MEDIA_HEIGHT = 174
export interface Point { x: number; y: number }
export type Positions = Record<string, Point>
export interface GroupBounds { id: string; label: string; x: number; y: number; width: number; height: number }
const options = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.randomSeed': '17',
  'elk.spacing.nodeNode': '100', 'elk.layered.spacing.nodeNodeBetweenLayers': '140',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.padding': '[top=46,left=26,bottom=26,right=26]',
}

// Stable, bounded offsets soften the layout without closing the gaps between cards.
function loosenPositions(positions: Positions): Positions {
  return Object.fromEntries(Object.entries(positions).map(([id, point]) => {
    let seed = 2166136261
    for (const character of id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
    seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b)
    return [id, { x: point.x + ((seed & 0xffff) / 65535 - .5) * 48,
      y: point.y + ((seed >>> 16) / 65535 - .5) * 84 }]
  }))
}

export function groupBounds(model: UniverseModel, positions: Positions): GroupBounds[] {
  return model.groups.flatMap(group => {
    const points = group.mediaIds.map(id => positions[id]).filter(Boolean)
    if (!points.length) return []
    const x = Math.min(...points.map(p => p.x)) - 26, y = Math.min(...points.map(p => p.y)) - 82
    return [{ id: group.id, label: group.label, x, y,
      width: Math.max(...points.map(p => p.x)) + MEDIA_WIDTH + 26 - x,
      height: Math.max(...points.map(p => p.y)) + MEDIA_HEIGHT + 26 - y }]
  })
}

/** Preserve existing media anchors on expansion and keep new cards inside their group's area. */
export function preservePositions(model: UniverseModel, proposed: Positions, previous: Positions): Positions {
  const positions: Positions = {}
  for (const item of model.media) if (previous[item.id]) positions[item.id] = previous[item.id]
  const overlap = (p: Point, other: Point) => Math.abs(p.x - other.x) < MEDIA_WIDTH + 48 && Math.abs(p.y - other.y) < MEDIA_HEIGHT + 56
  for (const group of model.groups) {
    const groupAnchor = group.mediaIds.find(id => positions[id] && proposed[id])
    const groupDx = groupAnchor ? positions[groupAnchor].x - proposed[groupAnchor].x : 0
    const groupDy = groupAnchor ? positions[groupAnchor].y - proposed[groupAnchor].y : 0
    for (const branch of model.branches.filter(branch => group.branchIds.includes(branch.id))) {
      const anchor = branch.mediaIds.find(id => positions[id] && proposed[id])
      const dx = anchor ? positions[anchor].x - proposed[anchor].x : groupDx
      const dy = anchor ? positions[anchor].y - proposed[anchor].y : groupDy
      for (const id of branch.mediaIds) {
        if (positions[id]) continue
        const point = { x: (proposed[id]?.x ?? 0) + dx, y: (proposed[id]?.y ?? 0) + dy }
        const otherPoints = model.groups.filter(other => other.id !== group.id)
          .flatMap(other => other.mediaIds.flatMap(id => positions[id] ? [positions[id]] : []))
        if (otherPoints.length) point.y = group.id === 'group:main'
          ? Math.min(point.y, Math.min(...otherPoints.map(p => p.y)) - MEDIA_HEIGHT - 180)
          : Math.max(point.y, Math.max(...otherPoints.map(p => p.y)) + MEDIA_HEIGHT + 180)
        if (Object.values(positions).some(p => overlap(point, p))) {
          point.x = Math.max(0, ...Object.values(positions).map(p => p.x)) + MEDIA_WIDTH + 100
        }
        positions[id] = point
      }
    }
  }
  return positions
}

export function fallbackPositions(model: UniverseModel): Positions {
  const positions: Positions = {}
  let top = 0
  for (const group of model.groups) {
    const rowWidth = Math.max(MEDIA_WIDTH + 100, Math.sqrt(group.mediaIds.length * (MEDIA_WIDTH + 100) * (MEDIA_HEIGHT + 140) * 2))
    let left = 0, row = top
    for (const branch of model.branches.filter(branch => group.branchIds.includes(branch.id))) {
      const width = branch.mediaIds.length * (MEDIA_WIDTH + 100)
      if (left && left + width > rowWidth) { left = 0; row += MEDIA_HEIGHT + 140 }
      branch.mediaIds.forEach((id, column) => { positions[id] = { x: left + column * (MEDIA_WIDTH + 100), y: row } })
      left += width
    }
    top = row + MEDIA_HEIGHT + 140 + 180
  }
  return loosenPositions(positions)
}

export async function layoutUniverse(model: UniverseModel, previous: Positions = {}): Promise<Positions> {
  if (!model.media.length) return {}
  // Load ELK only when a universe is opened, away from home/search/auth startup.
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  const groups = await Promise.all(model.branches.map(branch => elk.layout<ElkNode>({
    id: branch.id, layoutOptions: options,
    children: branch.mediaIds.map(id => ({ id, width: MEDIA_WIDTH, height: MEDIA_HEIGHT })),
    edges: model.links.filter(l => l.primary && model.branchByMedia[l.source] === branch.id && model.branchByMedia[l.target] === branch.id)
      .map(l => ({ id: l.id, sources: [l.source], targets: [l.target] })),
  })))
  const byBranch = new Map(groups.map(g => [g.id, g]))
  const positions: Positions = {}
  let top = 0
  // Keep the main series above related works; cross-links never decide which group a work belongs to.
  for (const group of model.groups) {
    const region = await elk.layout<ElkNode>({ id: group.id,
      layoutOptions: { 'elk.algorithm': 'box', 'elk.spacing.nodeNode': '120', 'elk.aspectRatio': '2', 'elk.randomSeed': '17' },
      children: group.branchIds.map(id => ({ id, width: byBranch.get(id)!.width, height: byBranch.get(id)!.height })),
    })
    for (const placement of region.children ?? []) {
      const branch = byBranch.get(placement.id)!
      for (const node of branch.children ?? []) positions[node.id] = {
        x: (placement.x ?? 0) + (node.x ?? 0), y: top + (placement.y ?? 0) + (node.y ?? 0),
      }
    }
    top += (region.height ?? 0) + 180
  }
  const loosened = loosenPositions(positions)
  return Object.keys(previous).length ? preservePositions(model, loosened, previous) : loosened
}
