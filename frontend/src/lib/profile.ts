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
/** The newest earned badge the user has not yet been congratulated on, if any. */
export function pendingCelebration(badges: Badge[], celebrated: string[]): Badge | null {
  return [...badges].reverse().find(badge => !celebrated.includes(badge.id)) ?? null
}
export function browserStorage(): Storage | null {
  try { return window.localStorage } catch { return null }
}
