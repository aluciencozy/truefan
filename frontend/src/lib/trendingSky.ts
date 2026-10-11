import { constellationLayout } from './constellation'
import type { TrendingConstellation } from './types'

// Pure layout maths for the trending sky. Same data and width give the same shapes on every load.
export interface Region { x: number; y: number; w: number; h: number }
export interface SkyStar { id: string; x: number; y: number; r: number; glow: number; opacity: number; delay: number }
export interface SkyLink { source: string; target: string; type: string; x1: number; y1: number; x2: number; y2: number; inferred: boolean }
export interface SkyConstellation { id: string; region: Region; label: { x: number; y: number; w: number }; stars: SkyStar[]; links: SkyLink[] }
export interface SkyLayout { width: number; height: number; columns: number; constellations: SkyConstellation[] }

export const LABEL_HEIGHT = 54
const GAP = 16
export const MIN_CELL_HEIGHT = 184
export const MAX_CELL_HEIGHT = 330
export const hashString = (text: string): number => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Radius grows with magnitude (0.25 to 1); `scale` shrinks everything on narrow screens. */
export const starRadius = (magnitude: number, scale = 1): number => (3.5 + Math.min(1, Math.max(0, magnitude)) * 6.5) * scale
export const starOpacity = (magnitude: number): number => .4 + .6 * Math.min(1, Math.max(0, magnitude))

/**
 * A loose grid: 1 column on phones (stacked, scrolls), 2 on tablets, 3 on desktop. A short last row is centred.
 * When `availableHeight` is known on wider screens the cells shrink so every row fits without scrolling.
 */
export function skyRegions(count: number, width: number, availableHeight?: number): { regions: Region[]; height: number; columns: number } {
  const narrow = width < 640
  const columns = Math.min(Math.max(1, count), narrow ? 1 : width < 1100 ? 2 : 3)
  const pad = narrow ? 16 : 32, top = 8
  const cellW = (width - pad * 2 - GAP * (columns - 1)) / columns
  const rows = Math.ceil(count / columns)
  const fit = availableHeight ? (availableHeight - top * 2 - GAP * (rows - 1)) / rows : MAX_CELL_HEIGHT
  const cellH = narrow ? 280 : Math.round(Math.min(MAX_CELL_HEIGHT, Math.max(MIN_CELL_HEIGHT, fit)))
  const regions: Region[] = []
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / columns), inRow = Math.min(columns, count - row * columns)
    const offset = (columns - inRow) * (cellW + GAP) / 2
    regions.push({ x: pad + offset + (index % columns) * (cellW + GAP), y: top + row * (cellH + GAP), w: cellW, h: cellH })
  }
  return { regions, height: top * 2 + rows * cellH + (rows - 1) * GAP, columns }
}

/** Deterministic star positions for one constellation, fitted inside `region` above its label strip. */
export function constellationShape(constellation: TrendingConstellation, region: Region, scale = 1): { stars: SkyStar[]; links: SkyLink[] } {
  const random = seededRandom(hashString(constellation.franchise_id))
  const ids = constellation.stars.map(star => star.media_id)
  const raw = constellationLayout(ids, constellation.links, constellation.entry_media_id)
  const angle = random() * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle)
  const spread = 1 + random() * .35  // squash so no two share a silhouette
  const points = ids.map(id => {
    const p = raw.get(id) ?? { x: 0, y: 0 }
    return { id, x: (p.x * cos - p.y * sin) + (random() - .5) * 90, y: ((p.x * sin + p.y * cos) + (random() - .5) * 90) / spread }
  })
  const stars = constellation.stars
  const radii = new Map(stars.map(star => [star.media_id, starRadius(star.magnitude, scale)]))
  const inset = 18 * scale + 10
  const box = { x: region.x + inset, y: region.y + inset, w: Math.max(1, region.w - inset * 2), h: Math.max(1, region.h - LABEL_HEIGHT - inset * 2) }
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
  // Fit each axis separately so wide, short cells are used fully; shapes never grow past their natural size.
  const fitX = Math.min(1, box.w / Math.max(1, maxX - minX)), fitY = Math.min(1, box.h / Math.max(1, maxY - minY))
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const placed = points.map(p => ({ id: p.id, x: box.x + box.w / 2 + (p.x - cx) * fitX, y: box.y + box.h / 2 + (p.y - cy) * fitY }))
  // A few relaxation passes keep glowing cores from touching; positions stay inside the box.
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const dx = placed[j].x - placed[i].x, dy = placed[j].y - placed[i].y
      const distance = Math.hypot(dx, dy) || .01
      const need = radii.get(placed[i].id)! + radii.get(placed[j].id)! + 14 * scale
      if (distance < need) {
        const push = (need - distance) / 2, ux = dx / distance || 1, uy = dy / distance
        placed[i].x -= ux * push; placed[i].y -= uy * push; placed[j].x += ux * push; placed[j].y += uy * push
      }
    }
    for (const p of placed) { p.x = Math.min(box.x + box.w, Math.max(box.x, p.x)); p.y = Math.min(box.y + box.h, Math.max(box.y, p.y)) }
  }
  const at = new Map(placed.map(p => [p.id, p]))
  return {
    stars: stars.map(star => ({ id: star.media_id, x: at.get(star.media_id)!.x, y: at.get(star.media_id)!.y, r: radii.get(star.media_id)!,
      glow: radii.get(star.media_id)! * 3, opacity: starOpacity(star.magnitude), delay: random() * 4 })),
    links: constellation.links.filter(link => at.has(link.source) && at.has(link.target)).map(link => ({
      source: link.source, target: link.target, type: link.type, inferred: link.type === 'INFERRED',
      x1: at.get(link.source)!.x, y1: at.get(link.source)!.y, x2: at.get(link.target)!.x, y2: at.get(link.target)!.y })),
  }
}

export function skyLayout(constellations: TrendingConstellation[], width: number, availableHeight?: number): SkyLayout {
  const { regions, height, columns } = skyRegions(constellations.length, width, availableHeight)
  const scale = width < 640 ? .85 : 1
  return {
    width, height, columns,
    constellations: constellations.map((constellation, index) => ({
      id: constellation.franchise_id, region: regions[index],
      label: { x: regions[index].x, y: regions[index].y + regions[index].h - LABEL_HEIGHT + 6, w: regions[index].w },
      ...constellationShape(constellation, regions[index], scale),
    })),
  }
}

/** Arrow keys move to the nearest star in that direction, or stay put when there is none. */
export function neighbourInDirection(stars: { id: string; x: number; y: number }[], fromId: string, key: string): string | null {
  const from = stars.find(star => star.id === fromId)
  const direction = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key]
  if (!from || !direction) return null
  let best: { id: string; cost: number } | null = null
  for (const star of stars) {
    if (star.id === fromId) continue
    const dx = star.x - from.x, dy = star.y - from.y
    const along = dx * direction[0] + dy * direction[1]
    if (along <= 0) continue
    const across = Math.abs(dx * direction[1] - dy * direction[0])
    const cost = Math.hypot(dx, dy) + across * .75
    if (!best || cost < best.cost) best = { id: star.id, cost }
  }
  return best?.id ?? null
}

const plural = (count: number, one: string, many: string) => count === 1 ? one : many
/** One wording everywhere (labels, cards, aria). `trueFan` names the source when the sky is driven by AniList trending. */
export const completionsLabel = (count: number, trueFan = false) => `${count} ${trueFan ? 'TrueFan ' : ''}${plural(count, 'completion', 'completions')} this month`
export const trendingLabel = (rank: number) => `Trending #${rank}`
/** Under a constellation's name: its best trending rank, then TrueFan completions only when there are any. */
export const constellationCaption = (rank: number | null, score: number, trending: boolean): string =>
  trending && rank ? [trendingLabel(rank), score > 0 ? completionsLabel(score, true) : ''].filter(Boolean).join(' · ') : completionsLabel(score)
export const starSubtitle = (star: { format: string | null; year: number | null }) => [star.format?.replaceAll('_', ' '), star.year].filter(Boolean).join(' · ')
