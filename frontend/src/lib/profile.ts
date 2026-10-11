import { request } from './api'
import type { SavedUniverse } from './library'

// Mirrors backend/app/profile_models.py and /openapi.json.
export interface Rank { id: string; title: string; min_points: number; badge: string | null }
export interface Badge { id: string; title: string; image: string; earned_at: string }
export interface Profile {
  points: number; rank: Rank; next_rank: Rank | null; points_to_next: number
  breakdown: { world_completed: number; universe_completed: number; universe_saved: number; community_post: number }
  stats: { universes_saved: number; worlds_completed: number; universes_completed: number; estimated_minutes_watched: number }
  favorite: SavedUniverse | null; badges: Badge[]; ranks: Rank[]
}
export const profileApi = {
  get: (signal?: AbortSignal) => request<Profile>('/api/me/profile', signal, true),
  setFavorite: (mediaId: string | null, signal?: AbortSignal) => request<Profile>('/api/me/profile', signal, true, {
    method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({favorite_media_id: mediaId}),
  }),
}
export type ProfileService = typeof profileApi

export const defaultAvatar = '/profile/default-avatar.svg'
// Keep in step with POINTS in backend/app/services/profile.py (the API is the source of truth for totals).
export const pointRules = [
  {label: 'Complete a world', detail: 'Each distinct title, counted once across universes', points: 10},
  {label: 'Complete a universe', detail: 'Bonus when every world in a saved universe is done', points: 25},
  {label: 'Save a universe', detail: 'Each saved universe you have not abandoned', points: 5},
  {label: 'Write a community post', detail: 'Up to 10 posts', points: 5},
] as const

export function rankProgress(profile: Pick<Profile, 'points' | 'rank' | 'next_rank' | 'points_to_next'>): { percent: number; label: string } {
  const next = profile.next_rank
  if (!next) return {percent: 100, label: 'Top rank reached'}
  const span = next.min_points - profile.rank.min_points
  const percent = span > 0 ? Math.min(100, Math.max(0, (profile.points - profile.rank.min_points) / span * 100)) : 0
  return {percent, label: `${profile.points_to_next} ${profile.points_to_next === 1 ? 'point' : 'points'} to ${next.title}`}
}


// The segmented badge track: one scale from 0 to the highest threshold, a segment between consecutive
// milestones, and a badge node at each milestone that has a badge.
export type NodeState = 'earned' | 'next' | 'locked'
export interface TrackSegment { from: string; to: string; fill: number; start: number; end: number; equalStart: number; equalEnd: number }
export interface TrackNode {
  id: string; title: string; badge: string; minPoints: number; state: NodeState
  position: number; equalPosition: number; earnedAt: string | null; pointsToGo: number; tooltip: string
}
export interface BadgeTrack { max: number; segments: TrackSegment[]; nodes: TrackNode[]; next: TrackNode | null }
const pointsLabel = (count: number) => `${count} ${count === 1 ? 'point' : 'points'}`
const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** Positions are given twice: proportional to points, and equal per segment for narrow screens. Fill is the same for both. */
export function badgeTrack(points: number, ranks: Rank[], badges: Pick<Badge, 'id' | 'earned_at'>[] = [], formatDate: (value: string) => string = shortDate): BadgeTrack {
  const milestones = [...ranks].sort((a, b) => a.min_points - b.min_points)
  const max = milestones.at(-1)?.min_points ?? 0
  const earned = new Map(badges.map(badge => [badge.id, badge.earned_at]))
  const last = Math.max(1, milestones.length - 1)
  const segments = milestones.slice(1).map((to, index) => {
    const from = milestones[index]
    const span = to.min_points - from.min_points
    return {
      from: from.id, to: to.id, fill: span > 0 ? Math.min(100, Math.max(0, (points - from.min_points) / span * 100)) : 0,
      start: max ? from.min_points / max * 100 : 0, end: max ? to.min_points / max * 100 : 0,
      equalStart: index / last * 100, equalEnd: (index + 1) / last * 100,
    }
  })
  let goal = false
  const nodes: TrackNode[] = []
  milestones.forEach((rank, index) => {
    if (!rank.badge) return
    const earnedAt = earned.get(rank.id) ?? null
    const pointsToGo = Math.max(0, rank.min_points - points)
    const state: NodeState = earnedAt ? 'earned' : goal ? 'locked' : 'next'
    if (state === 'next') goal = true
    nodes.push({
      id: rank.id, title: rank.title, badge: rank.badge, minPoints: rank.min_points, state, earnedAt, pointsToGo,
      position: max ? rank.min_points / max * 100 : 0, equalPosition: index / last * 100,
      tooltip: earnedAt ? `${rank.title} · Earned ${formatDate(earnedAt)}` : `${rank.title} · ${pointsLabel(rank.min_points)} · ${pointsLabel(pointsToGo)} to go`,
    })
  })
  return { max, segments, nodes, next: nodes.find(node => node.state === 'next') ?? null }
}
export function trackValueText(points: number, max: number, rank: Rank, next: Rank | null): string {
  const total = points > max ? pointsLabel(points) : `${points} of ${max} points`
  return `${total}, ${rank.title}, ${next ? `${pointsLabel(Math.max(0, next.min_points - points))} to ${next.title}` : 'top rank reached'}`
}

// "Already congratulated" lives in this browser only; the earned badge itself is stored server-side.
export const celebrationKey = (viewerId: string) => `truefan:celebrated-badges:${viewerId}`
export function readCelebrated(storage: Pick<Storage, 'getItem'> | null, key: string): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}
export function markCelebrated(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string, id: string): void {
  try { storage?.setItem(key, JSON.stringify([...new Set([...readCelebrated(storage, key), id])])) } catch { /* storage unavailable */ }
}
const tierIndex = (ranks: Pick<Rank, 'id'>[], id: string) => ranks.findIndex(rank => rank.id === id)
/** Earned badges in tier order (lowest first). Without `ranks` the given order is kept. */
export function byTier(badges: Badge[], ranks: Pick<Rank, 'id'>[] = []): Badge[] {
  return ranks.length ? [...badges].sort((a, b) => tierIndex(ranks, a.id) - tierIndex(ranks, b.id)) : [...badges]
}
/** The highest-tier earned badge, if any. */
export function highestBadge(badges: Badge[], ranks: Pick<Rank, 'id'>[] = []): Badge | null {
  return byTier(badges, ranks).at(-1) ?? null
}
/** The highest earned badge the user has not yet been congratulated on, if any. */
export function pendingCelebration(badges: Badge[], celebrated: string[], ranks: Pick<Rank, 'id'>[] = []): Badge | null {
  return highestBadge(badges.filter(badge => !celebrated.includes(badge.id)), ranks)
}
export interface Celebration { badge: Badge; more: number; unseen: string[] }
/** The celebration to show: the highest new badge plus how many lower ones were earned at the same time. */
export function celebrationFor(badges: Badge[], celebrated: string[], ranks: Pick<Rank, 'id'>[] = []): Celebration | null {
  const unseen = byTier(badges.filter(badge => !celebrated.includes(badge.id)), ranks)
  const badge = unseen.at(-1)
  return badge ? { badge, more: unseen.length - 1, unseen: unseen.map(item => item.id) } : null
}
export function celebrationCopy({ badge, more }: Pick<Celebration, 'badge' | 'more'>): { heading: string; body: string } {
  const article = /^[aeiou]/i.test(badge.title) ? 'an' : 'a'
  return {
    heading: `You’re now ${article} ${badge.title}`,
    body: more > 0
      ? `You also earned ${more} more ${more === 1 ? 'badge' : 'badges'} on the way. Every badge stays yours, even if your progress changes.`
      : `Your ${badge.title} badge stays yours, even if your progress changes.`,
  }
}
export function browserStorage(): Storage | null {
  try { return window.localStorage } catch { return null }
}
