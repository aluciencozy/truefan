import { request } from './api'
import type { Media, MediaReleaseDate } from './types'

// Mirrors backend/app/library_models.py and /openapi.json.
export interface LibraryTitle {
  media_id: string; title: string; cover_url: string | null; type: Media['type']
  format: string | null; release_date: MediaReleaseDate | null; completed: boolean
  estimated_minutes_watched: number
}
export interface SavedUniverse {
  media_id: string; title: string; cover_url: string | null; type: Media['type']; format: string | null
  titles: LibraryTitle[]; viewed_count: number; total_count: number; coverage_incomplete: boolean
  pinned: boolean; rating: number | null; saved_at: string; last_explored_at: string
}
export interface UniversePreferences { pinned?: boolean; rating?: number | null }
export const libraryApi = {
  list: (signal?: AbortSignal) => request<SavedUniverse[]>('/api/me/universes', signal, true),
  save: (id: string, signal?: AbortSignal) => request<SavedUniverse>(`/api/me/universes/${encodeURIComponent(id)}`, signal, true, {method: 'POST'}),
  update: (id: string, preferences: UniversePreferences, signal?: AbortSignal) => request<SavedUniverse>(`/api/me/universes/${encodeURIComponent(id)}`, signal, true, {
    method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(preferences),
  }),
  abandon: (id: string, signal?: AbortSignal) => request<{media_id: string; abandoned: true}>(`/api/me/universes/${encodeURIComponent(id)}/abandon`, signal, true, {method: 'POST'}),
}
export type LibraryService = typeof libraryApi
export const libraryArt = {
  bell: '/library/9fd0c.svg', help: '/library/48740.svg', plus: '/library/c572a.svg', orbit: '/library/1792f.svg',
  search: '/library/4f250.svg', filters: '/library/d37bf.svg', sort: '/library/ecb04.svg', list: '/library/39c1b.svg',
  grid: '/library/9e694.svg', dots: '/library/7c371.svg',
  maps: ['/library/4a940.svg', '/library/3eaea.svg', '/library/dcd55.svg'],
}
export function universeStatus(item: SavedUniverse): 'Exploring' | 'Completed' {
  return item.total_count > 0 && item.viewed_count === item.total_count ? 'Completed' : 'Exploring'
}
export function estimatedHoursWatched(items: SavedUniverse[]): number {
  const minutes = new Map<string, number>()
  for (const item of items) for (const title of item.titles) {
    minutes.set(title.media_id, Math.max(minutes.get(title.media_id) ?? 0, title.estimated_minutes_watched))
  }
  return [...minutes.values()].reduce((total, value) => total + value, 0) / 60
}
// One source for every stat shown on Library and Profile so the two screens cannot disagree.
export interface LibraryStats {
  universesSaved: number; exploring: number; universesCompleted: number
  worldsCompleted: number; estimatedHours: number
}
export function libraryStats(items: SavedUniverse[]): LibraryStats {
  const completed = new Set<string>()
  for (const item of items) for (const title of item.titles) if (title.completed) completed.add(title.media_id)
  const universesCompleted = items.filter(item => universeStatus(item) === 'Completed').length
  return {
    universesSaved: items.length, exploring: items.length - universesCompleted, universesCompleted,
    worldsCompleted: completed.size, estimatedHours: estimatedHoursWatched(items),
  }
}
export function libraryOrder(items: SavedUniverse[], sort: string): SavedUniverse[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'title' ? a.title.localeCompare(b.title)
    : sort === 'saved' ? Date.parse(b.saved_at) - Date.parse(a.saved_at)
      : Date.parse(b.last_explored_at) - Date.parse(a.last_explored_at)) || a.media_id.localeCompare(b.media_id))
}
