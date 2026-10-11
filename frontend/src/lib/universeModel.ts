import type { Media, Universe, UniverseRelation } from './types'

export interface UniverseLink {
  id: string; source: string; target: string; kind: string
  primary: boolean; directional: boolean; relations: UniverseRelation[]
}
export interface UniverseBranch { id: string; mediaIds: string[] }
export interface UniverseGroup { id: string; label: string; branchIds: string[]; mediaIds: string[] }
export interface UniverseModel {
  media: Media[]; links: UniverseLink[]; branches: UniverseBranch[]; branchByMedia: Record<string, string>; groups: UniverseGroup[]
  progression: UniverseLink[]; startId: string | null
}
export const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
/** Missing date components sort last; IDs break ties without inventing dates. */
export function compareRelease(a: Media, b: Media): number {
  for (const part of ['year', 'month', 'day'] as const) {
    const difference = (a.release_date?.[part] ?? Infinity) - (b.release_date?.[part] ?? Infinity)
    if (!Number.isNaN(difference) && difference) return difference
  }
  return compareId(a.id, b.id)
}
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
  const formatFamily = (m: Media) => ['TV', 'TV_SHORT', 'ONA', 'MOVIE'].includes(m.format ?? '') ? 'storyline' : m.format ?? m.type
  const sameFormat = (link: UniverseLink) => {
    const a = byId.get(link.source)!, b = byId.get(link.target)!
    return a.type === b.type && formatFamily(a) === formatFamily(b)
  }
  const eligible = continuations.filter(sameFormat)
  const group = new Map(media.map(m => [m.id, m.id]))
  const find = (id: string): string => {
    let next = id
    while (group.get(next) !== next) next = group.get(next)!
    return next
  }
  const barriers = links.filter(l => separate.has(l.kind) && l.source !== l.target)
  for (const link of eligible) {
    // A fork alone is not evidence of a separate series; explicit alternate/spinoff relations are.
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
  // Follow explicit parent evidence when the selected entry is itself a spinoff or side story.
  let anchor = universe.root_id
  const seen = new Set<string>()
  while (!seen.has(anchor)) {
    seen.add(anchor)
    const members = branches.find(branch => branch.id === branchByMedia[anchor])?.mediaIds ?? [anchor]
    const parent = links.find(link => link.kind === 'PARENT' && members.includes(link.source) && !members.includes(link.target)
      || ['SPIN_OFF', 'SIDE_STORY'].includes(link.kind) && members.includes(link.target) && !members.includes(link.source))
    if (!parent) break
    anchor = parent.kind === 'PARENT' ? parent.target : parent.source
  }
  let mainId = branchByMedia[anchor]
  // An optional OVA entry should still lead to its directly connected main storyline.
  if (byId.has(anchor) && formatFamily(byId.get(anchor)!) !== 'storyline') {
    const series = continuations.flatMap(link => link.source === anchor ? [link.target] : link.target === anchor ? [link.source] : [])
      .find(id => formatFamily(byId.get(id)!) === 'storyline')
    if (series) mainId = branchByMedia[series]
  }
  if (!mainId) mainId = branches[0]?.id
  const groups: UniverseGroup[] = [
    { id: 'group:main', label: 'Main storyline', branchIds: branches.filter(b => b.id === mainId).map(b => b.id), mediaIds: [] },
    { id: 'group:related', label: 'Extras & spinoffs', branchIds: branches.filter(b => b.id !== mainId).map(b => b.id), mediaIds: [] },
  ].map(group => ({ ...group, mediaIds: branches.filter(b => group.branchIds.includes(b.id)).flatMap(b => b.mediaIds) }))
    .filter(group => group.mediaIds.length)
  const mainIds = new Set(groups.find(g => g.id === 'group:main')?.mediaIds)
  const candidates = links.flatMap(link => {
    if (!['SEQUEL', 'PARENT', 'SPIN_OFF', 'SIDE_STORY'].includes(link.kind) || link.source === link.target) return []
    const source = link.kind === 'PARENT' ? link.target : link.source
    const target = link.kind === 'PARENT' ? link.source : link.target
    // Optional works must never become a prerequisite for the main story.
    if (mainIds.has(target) && !mainIds.has(source)) return []
    return [{ ...link, source, target }]
  })
  const rank = (link: UniverseLink) => link.kind === 'SEQUEL' && branchByMedia[link.source] === branchByMedia[link.target] ? 0
    : link.kind !== 'SEQUEL' ? 1 : 2
  const earlier = (link: UniverseLink) => {
    const source = byId.get(link.source)!, target = byId.get(link.target)!
    return Boolean(source.release_date?.year && target.release_date?.year && compareRelease(source, target) < 0)
  }
  candidates.sort((a, b) => rank(a) - rank(b) || Number(earlier(b)) - Number(earlier(a))
    || compareRelease(byId.get(a.target)!, byId.get(b.target)!)
    || (earlier(a) && earlier(b) ? compareRelease(byId.get(b.source)!, byId.get(a.source)!) : 0)
    || compareId(a.source, b.source) || compareId(a.id, b.id))
  const parents = new Map<string, string>()
  const progression: UniverseLink[] = []
  for (const link of candidates) {
    if (parents.has(link.target)) continue
    let ancestor: string | undefined = link.source
    while (ancestor && ancestor !== link.target) ancestor = parents.get(ancestor)
    if (ancestor === link.target) continue
    parents.set(link.target, link.source)
    links.find(raw => raw.id === link.id)!.primary = true
    progression.push({ ...link, id: JSON.stringify(['unlock', link.source, link.target]), primary: true, directional: true })
  }
  progression.sort((a, b) => compareId(a.id, b.id))
  const startId = media.filter(m => mainIds.has(m.id) && !parents.has(m.id)).sort(compareRelease)[0]?.id ?? null
  return { media, links, branches, branchByMedia, groups, progression, startId }
}

/** Only the visible frontier participates in layout, navigation, and optional cross-links. */
export function visibleUniverse(model: UniverseModel, visibleIds: Set<string>): UniverseModel {
  const branches = model.branches.map(b => ({ ...b, mediaIds: b.mediaIds.filter(id => visibleIds.has(id)) })).filter(b => b.mediaIds.length)
  return { ...model, media: model.media.filter(m => visibleIds.has(m.id)), branches,
    groups: model.groups.map(g => ({ ...g, mediaIds: g.mediaIds.filter(id => visibleIds.has(id)),
      branchIds: g.branchIds.filter(id => branches.some(b => b.id === id)) })).filter(g => g.mediaIds.length),
    links: model.links.filter(l => visibleIds.has(l.source) && visibleIds.has(l.target)),
    progression: model.progression.filter(l => visibleIds.has(l.source) && visibleIds.has(l.target)),
  }
}

export function displayLinks(model: UniverseModel, related: boolean): UniverseLink[] {
  const pair = (a: string, b: string) => JSON.stringify([a, b].sort(compareId))
  const taken = new Set(model.progression.map(l => pair(l.source, l.target)))
  const secondary = new Map<string, UniverseLink>()
  if (related) for (const link of model.links) {
    const key = pair(link.source, link.target)
    if (link.source === link.target || taken.has(key)) continue
    const existing = secondary.get(key)
    if (existing) {
      existing.relations.push(...link.relations)
      existing.kind = [...new Set(existing.relations.map(r => r.type.toUpperCase()))].sort(compareId).join(' / ')
    } else secondary.set(key, { ...link, id: `related:${key}`, primary: false, directional: false, relations: [...link.relations] })
  }
  return [...model.progression, ...secondary.values()]
}
