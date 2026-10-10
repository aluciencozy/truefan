import { authClient } from './auth'
import type { CurrentUser, GraphResponse, HealthResponse, Media } from './types'

const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

async function request<T>(path: string, signal?: AbortSignal, authenticated = false): Promise<T> {
  const headers = new Headers()
  if (authenticated) {
    if (!authClient) throw new Error('Configure Neon Auth before accessing your account.')
    const { data, error } = await authClient.token()
    if (error || !data?.token) throw new Error('Sign in before accessing your account.')
    headers.set('Authorization', `Bearer ${data.token}`)
  }
  const response = await fetch(`${baseUrl}${path}`, { signal, headers })
  if (!response.ok) throw new Error(`API request failed (${response.status}). Check the backend and environment settings.`)
  return response.json() as Promise<T>
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/health', signal),
  search: (q: string, signal?: AbortSignal) => request<Media[]>(`/api/media/search?q=${encodeURIComponent(q)}`, signal),
  media: (id: string, signal?: AbortSignal) => request<Media>(`/api/media/${encodeURIComponent(id)}`, signal),
  graph: (id: string, progress: number, signal?: AbortSignal) =>
    request<GraphResponse>(`/api/media/${encodeURIComponent(id)}/graph?progress=${progress}`, signal),
  me: () => request<CurrentUser>('/api/me', undefined, true),
}
