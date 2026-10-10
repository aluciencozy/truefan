import { authClient } from './auth'
import type { CurrentUser, GenerationStatus, Universe, GraphResponse, HealthResponse, Media, UserProgress } from './types'

const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

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

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/health', signal),
  search: (q: string, signal?: AbortSignal) => request<Media[]>(`/api/media/search?q=${encodeURIComponent(q)}`, signal),
  media: (id: string, signal?: AbortSignal) => request<Media>(`/api/media/${encodeURIComponent(id)}`, signal),
  graph: (id: string, progress: number, signal?: AbortSignal) =>
    request<GraphResponse>(`/api/media/${encodeURIComponent(id)}/graph?progress=${progress}`, signal),
  universe: (id: string, signal?: AbortSignal) => request<Universe>(`/api/media/${encodeURIComponent(id)}/universe`, signal),
  generate: (id: string, operation: 'start' | 'retry' | 'extend' = 'start', signal?: AbortSignal) =>
    request<GenerationStatus>(`/api/media/${encodeURIComponent(id)}/generation`, signal, true, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation }),
    }),
  progress: (id: string) => request<UserProgress | null>(`/api/me/progress/${encodeURIComponent(id)}`, undefined, true),
  saveProgress: (id: string, unit: number) => request<UserProgress>(`/api/me/progress/${encodeURIComponent(id)}`, undefined, true, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit }),
  }),
  me: () => request<CurrentUser>('/api/me', undefined, true),
}
