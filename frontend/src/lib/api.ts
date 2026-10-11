import { authClient } from './auth'
   import type { CurrentUser, FlowGraphResponse, GenerationStatus, GraphExtractRequest, GraphResponse, HealthResponse, Media, SurprisePick, TrendingConstellations, TrendingCover, Universe, UniverseSearchResponse, UserMediaState, UserProgress } from './types'

const baseUrl = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

export async function request<T>(path: string, signal?: AbortSignal, authenticated = false, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (authenticated) {
    if (!authClient) throw new Error('Configure Neon Auth before accessing your account.')
    // shortcut: Neon Auth 0.5.0-beta caches /token as /get-session; remove when the SDK fixes this.
    // The SDK consumes and strips this header before sending the request to Neon.
    const { data, error } = await authClient.token({
      fetchOptions: { headers: { 'X-Force-Fetch': 'true' } },
    })
    if (error || !data?.token) throw new Error('Sign in before accessing your account.')
    headers.set('Authorization', `Bearer ${data.token}`)
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new Error(typeof body?.detail === 'string' ? body.detail : `API request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

// Cache only public media metadata and universe maps, never account state or character facts.
const publicMaps = new Map<string, { expires: number; promise: Promise<unknown> }>()
function publicMap<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'))
  let entry = publicMaps.get(path)
  if (!entry || entry.expires < Date.now()) {
    const promise = request<T>(path)
    entry = { expires: Date.now() + 300_000, promise }
    publicMaps.set(path, entry)
    if (publicMaps.size > 20) publicMaps.delete(publicMaps.keys().next().value!)
    void promise.catch(() => { if (publicMaps.get(path)?.promise === promise) publicMaps.delete(path) })
  }
  // A cancelled visit must not cancel a shared prefetch for the next visit.
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    entry.promise.then(value => { signal?.removeEventListener('abort', abort); if (!signal?.aborted) resolve(value as T) }, error => { signal?.removeEventListener('abort', abort); reject(error) })
  })
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/health', signal),
  trendingConstellations: (limit = 5, signal?: AbortSignal) => request<TrendingConstellations>(`/api/trending/constellations?limit=${limit}`, signal),
  trendingCovers: (signal?: AbortSignal) => request<TrendingCover[]>('/api/media/trending', signal),
  surprise: (exclude?: string, signal?: AbortSignal) => request<SurprisePick>(`/api/media/surprise${exclude ? `?exclude=${encodeURIComponent(exclude)}` : ''}`, signal),
  search: (q: string, signal?: AbortSignal) => request<Media[]>(`/api/media/search?q=${encodeURIComponent(q)}`, signal),
  searchUniverses: (q: string, discover = false, signal?: AbortSignal) =>
    request<UniverseSearchResponse>(`/api/universes/search?q=${encodeURIComponent(q)}&discover=${discover}`, signal),
  media: (id: string, signal?: AbortSignal) => publicMap<Media>(`/api/media/${encodeURIComponent(id)}`, signal),
  graph: (id: string, progress: number, signal?: AbortSignal) =>
    request<GraphResponse>(`/api/media/${encodeURIComponent(id)}/graph?progress=${progress}`, signal),
  extractGraph: (id: string, body: GraphExtractRequest, signal?: AbortSignal) =>
    request<FlowGraphResponse>(`/api/media/${encodeURIComponent(id)}/extract`, signal, true, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  universe: (id: string, signal?: AbortSignal) => publicMap<Universe>(`/api/media/${encodeURIComponent(id)}/universe`, signal),
  prefetchUniverse: async (id: string): Promise<void> => {
    await Promise.all([api.media(id), api.universe(id)]).catch(() => undefined)
  },
  expandUniverse: (id: string, revision: number, signal?: AbortSignal) => {
    publicMaps.delete(`/api/media/${encodeURIComponent(id)}/universe`)
    return request<Universe>(`/api/media/${encodeURIComponent(id)}/universe/expand`, signal, false, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: revision }),
    })
  },
  mediaState: async (ids: string[], signal?: AbortSignal): Promise<UserMediaState[]> => {
    const unique = [...new Set(ids)].sort()
    const batches: string[][] = []
    for (let start = 0; start < unique.length; start += 50) batches.push(unique.slice(start, start + 50))
    const results = await Promise.all(batches.map(batch => request<UserMediaState[]>(
      `/api/me/media-state?${new URLSearchParams(batch.map(id => ['media_id', id]))}`, signal, true)))
    return results.flat()
  },
  saveMediaState: (id: string, flags: { completed?: boolean; manual_unlocked?: boolean }, signal?: AbortSignal) =>
    request<UserMediaState>(`/api/me/media-state/${encodeURIComponent(id)}`, signal, true, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flags),
    }),
  generate: (id: string, operation: 'start' | 'retry' | 'extend' = 'start', signal?: AbortSignal) =>
    request<GenerationStatus>(`/api/media/${encodeURIComponent(id)}/generation`, signal, true, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation }),
    }),
  progress: (id: string) => request<UserProgress | null>(`/api/me/progress/${encodeURIComponent(id)}`, undefined, true),
  saveProgress: async (id: string, unit: number): Promise<UserProgress> => {
    const [saved] = await api.mediaState([id])
    return request<UserProgress>(`/api/me/progress/${encodeURIComponent(id)}`, undefined, true, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: Math.max(unit, saved.progress?.unit ?? 0) }),
    })
  },
  me: () => request<CurrentUser>('/api/me', undefined, true),
}
