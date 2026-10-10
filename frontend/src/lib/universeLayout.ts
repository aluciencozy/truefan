import type { ElkNode } from 'elkjs'
import type { UniverseModel } from './universeModel.ts'
import { compareId } from './universeModel.ts'

export const MEDIA_WIDTH = 176
export const MEDIA_HEIGHT = 174
export interface Point { x: number; y: number }
export type Positions = Record<string, Point>
export interface BranchBounds { id: string; x: number; y: number; width: number; height: number }
const options = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.randomSeed': '17',
  'elk.spacing.nodeNode': '70', 'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.padding': '[top=46,left=26,bottom=26,right=26]',
}

export function branchBounds(model: UniverseModel, positions: Positions): BranchBounds[] {
  return model.branches.flatMap(branch => {
    const points = branch.mediaIds.map(id => positions[id]).filter(Boolean)
    if (!points.length) return []
    const x = Math.min(...points.map(p => p.x)) - 26, y = Math.min(...points.map(p => p.y)) - 46
    return [{ id: branch.id, x, y,
      width: Math.max(...points.map(p => p.x)) + MEDIA_WIDTH + 26 - x,
      height: Math.max(...points.map(p => p.y)) + MEDIA_HEIGHT + 26 - y }]
  })
}

/** Preserve existing media anchors on expansion; append only new nodes when their ELK positions collide. */
export function preservePositions(model: UniverseModel, proposed: Positions, previous: Positions): Positions {
  const positions: Positions = {}
  for (const item of model.media) if (previous[item.id]) positions[item.id] = previous[item.id]
  const overlap = (p: Point, other: Point) => Math.abs(p.x - other.x) < MEDIA_WIDTH + 48 && Math.abs(p.y - other.y) < MEDIA_HEIGHT + 56
  for (const branch of model.branches) {
    const anchor = branch.mediaIds.find(id => positions[id] && proposed[id])
    const dx = anchor ? positions[anchor].x - proposed[anchor].x : 0
    const dy = anchor ? positions[anchor].y - proposed[anchor].y : 0
    for (const id of branch.mediaIds) {
      if (positions[id]) continue
      const point = { x: (proposed[id]?.x ?? 0) + dx, y: (proposed[id]?.y ?? 0) + dy }
      if (Object.values(positions).some(p => overlap(point, p))) {
        point.x = Math.max(0, ...Object.values(positions).map(p => p.x)) + MEDIA_WIDTH + 100
        point.y = anchor ? positions[anchor].y : 0
      }
      positions[id] = point
    }
  }
  return positions
}

export function fallbackPositions(model: UniverseModel): Positions {
  return Object.fromEntries(model.branches.flatMap((branch, row) => branch.mediaIds.map((id, column) =>
    [id, { x: column * (MEDIA_WIDTH + 100), y: row * (MEDIA_HEIGHT + 140) }],
  )))
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
  const adjacency = new Map(groups.map(g => [g.id, new Set<string>()]))
  const component = new Map(groups.map(g => [g.id, g.id]))
  const find = (id: string): string => {
    let cursor = id
    while (component.get(cursor) !== cursor) cursor = component.get(cursor)!
    return cursor
  }
  const priority = (kind: string) => kind === 'SEQUEL' ? 0 : ['ADAPTATION', 'SOURCE'].includes(kind) ? 1
    : ['ALTERNATIVE', 'SPIN_OFF', 'SIDE_STORY', 'PARENT'].includes(kind) ? 2 : 3
  // A semantic spanning forest is only a geometric scaffold; all actual cross-links are still rendered.
  for (const link of [...model.links].sort((a, b) => priority(a.kind) - priority(b.kind) || compareId(a.id, b.id))) {
    const a = model.branchByMedia[link.source], b = model.branchByMedia[link.target]
    const ca = find(a), cb = find(b)
    if (ca === cb) continue
    component.set(compareId(ca, cb) < 0 ? cb : ca, compareId(ca, cb) < 0 ? ca : cb)
    adjacency.get(a)!.add(b); adjacency.get(b)!.add(a)
  }
  const components = new Map<string, string[]>()
  for (const group of groups) components.set(find(group.id), [...(components.get(find(group.id)) ?? []), group.id])
  const regions = await Promise.all([...components.entries()].map(async ([id, members]) => {
    const center = [...members].sort((a, b) => adjacency.get(b)!.size - adjacency.get(a)!.size || compareId(a, b))[0]
    const seen = new Set([center]), queue = [center]
    const edges: { id: string; sources: string[]; targets: string[] }[] = []
    for (let index = 0; index < queue.length; index++) {
      const source = queue[index]
      for (const target of [...adjacency.get(source)!].sort(compareId)) {
        if (seen.has(target)) continue
        seen.add(target); queue.push(target); edges.push({ id: JSON.stringify([source, target]), sources: [source], targets: [target] })
      }
    }
    return elk.layout<ElkNode>({ id: `region:${id}`,
      layoutOptions: { 'elk.algorithm': 'radial', 'elk.randomSeed': '17', 'elk.spacing.nodeNode': '100',
        'elk.radial.compactor': 'RADIAL', 'elk.padding': '[top=20,left=20,bottom=20,right=20]' },
      children: [center, ...members.filter(m => m !== center)].map(id => ({ id, width: byBranch.get(id)!.width, height: byBranch.get(id)!.height })),
      edges,
    })
  }))
  const outer = await elk.layout<ElkNode>({ id: 'universe',
    layoutOptions: { 'elk.algorithm': 'box', 'elk.spacing.nodeNode': '180', 'elk.aspectRatio': '1.4', 'elk.randomSeed': '17' },
    children: regions.map(r => ({ id: r.id, width: r.width, height: r.height })),
  })
  const origins = new Map((outer.children ?? []).map(r => [r.id, r]))
  const placements = new Map<string, ElkNode>()
  for (const region of regions) for (const group of region.children ?? []) {
    const origin = origins.get(region.id)!
    placements.set(group.id, { ...group, x: (origin.x ?? 0) + (group.x ?? 0), y: (origin.y ?? 0) + (group.y ?? 0) })
  }
  const positions: Positions = {}
  for (const group of groups) {
    const origin = placements.get(group.id) as ElkNode
    for (const node of group.children ?? []) positions[node.id] = { x: (origin.x ?? 0) + (node.x ?? 0), y: (origin.y ?? 0) + (node.y ?? 0) }
  }
  return Object.keys(previous).length ? preservePositions(model, positions, previous) : positions
}
