import type { Media, Universe, UniverseRelation } from './types'

export interface UniverseLink {
  id: string; source: string; target: string; kind: string
  primary: boolean; directional: boolean; relations: UniverseRelation[]
}
export interface UniverseBranch { id: string; mediaIds: string[] }
export interface UniverseModel {
  media: Media[]; links: UniverseLink[]; branches: UniverseBranch[]; branchByMedia: Record<string, string>
}
export const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const symmetric = new Set(['ALTERNATIVE', 'ADAPTATION', 'CHARACTER', 'OTHER', 'SAME_UNIVERSE'])
const separate = new Set(['ALTERNATIVE', 'SPIN_OFF', 'SIDE_STORY', 'PARENT', 'ADAPTATION', 'SOURCE'])
export const relationLabel = (type: string) => type.toLowerCase().replaceAll('_', ' ')

/** AniList directions are retained in evidence; only PREQUEL is reversed for placement. */
export function buildUniverseModel(universe: Universe): UniverseModel {
  const byId = new Map<string, Media>()
  // A stable duplicate winner avoids provider/discovery order becoming layout order.
  for (const media of [...universe.media].sort((a, b) => compareId(a.id, b.id) || compareId(JSON.stringify(a), JSON.stringify(b)))) {
    if (!byId.has(media.id)) byId.set(media.id, media)
  }
  const media = [...byId.values()]
  const linksById = new Map<string, UniverseLink>()
  const raw = [...universe.relationships].sort((a, b) => compareId(JSON.stringify([a.source, a.target, a.type]), JSON.stringify([b.source, b.target, b.type])))
  for (const relation of raw) {
    if (!byId.has(relation.source) || !byId.has(relation.target)) continue
    const type = relation.type.trim().toUpperCase()
    let source = type === 'PREQUEL' ? relation.target : relation.source
    let target = type === 'PREQUEL' ? relation.source : relation.target
    const kind = type === 'PREQUEL' ? 'SEQUEL' : type
    if (symmetric.has(kind) && compareId(source, target) > 0) [source, target] = [target, source]
    const id = JSON.stringify([source, target, kind])
    const link = linksById.get(id) ?? { id, source, target, kind, primary: false, directional: kind === 'SEQUEL', relations: [] }
    if (!link.relations.some(r => r.source === relation.source && r.target === relation.target && r.type === relation.type)) link.relations.push(relation)
    linksById.set(id, link)
  }
  const links = [...linksById.values()].sort((a, b) => compareId(a.id, b.id))
  const continuations = links.filter(l => l.kind === 'SEQUEL' && l.source !== l.target)
  const formatFamily = (m: Media) => ['TV', 'TV_SHORT', 'ONA'].includes(m.format ?? '') ? 'series' : m.format ?? m.type
  const sameFormat = (link: UniverseLink) => {
    const a = byId.get(link.source)!, b = byId.get(link.target)!
    return a.type === b.type && formatFamily(a) === formatFamily(b)
  }
  const eligible = continuations.filter(sameFormat)
  const parents = new Map<string, string>()
  // One primary incoming edge, no cycles. Remaining real connections stay visible as cross-links.
  for (const link of [...eligible, ...continuations.filter(l => !sameFormat(l))]) {
    if (parents.has(link.target)) continue
    let ancestor: string | undefined = link.source
    while (ancestor && ancestor !== link.target) ancestor = parents.get(ancestor)
    if (ancestor === link.target) continue
    parents.set(link.target, link.source); link.primary = true
  }
  const incoming = new Map<string, number>(), outgoing = new Map<string, number>()
  for (const link of eligible) {
    outgoing.set(link.source, (outgoing.get(link.source) ?? 0) + 1)
    incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1)
  }
  const group = new Map(media.map(m => [m.id, m.id]))
  const find = (id: string): string => {
    let next = id
    while (group.get(next) !== next) next = group.get(next)!
    return next
  }
  const barriers = links.filter(l => separate.has(l.kind) && l.source !== l.target)
  for (const link of eligible) {
    // Forks/multiple parents start new branches; explicit alternative/spinoff evidence prevents transitive merging.
    if (!link.primary || outgoing.get(link.source) !== 1 || incoming.get(link.target) !== 1) continue
    const a = find(link.source), b = find(link.target)
    if (a === b || barriers.some(l => (find(l.source) === a && find(l.target) === b) || (find(l.source) === b && find(l.target) === a))) continue
    group.set(compareId(a, b) < 0 ? b : a, compareId(a, b) < 0 ? a : b)
  }
  const grouped = new Map<string, string[]>()
  const branchByMedia: Record<string, string> = {}
  for (const item of media) {
    const id = `branch:${find(item.id)}`
    grouped.set(id, [...(grouped.get(id) ?? []), item.id]); branchByMedia[item.id] = id
  }
  const branches = [...grouped].map(([id, mediaIds]) => ({ id, mediaIds })).sort((a, b) => compareId(a.id, b.id))
  return { media, links, branches, branchByMedia }
}
