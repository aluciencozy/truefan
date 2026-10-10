import { request } from './api'

export type PostCategory = 'discussion' | 'theory' | 'review'
export interface CommunityPost {
  id: string; category: PostCategory; media: string; title: string; body: string
  author: string; created_at: string; contains_spoilers: boolean; rating: number | null
  likes: number; comments: number; liked: boolean; example: boolean
}
export interface CommunityComment {
  id: string; author: string; body: string; contains_spoilers: boolean; created_at: string
}
export interface CommunityFeed { posts: CommunityPost[]; media: string[]; active_fans: number; has_more: boolean }
export interface PostCreate {
  category: PostCategory; media: string; title: string; body: string; contains_spoilers: boolean; rating: number | null
}
export interface LibraryItem { media_id: string; title: string; completed: boolean }
export interface FeedFilters { category: PostCategory | ''; media: string; q: string; sort: 'latest' | 'popular'; spoilers: boolean; offset: number }

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const spoilerQuery = (show: boolean) => `?include_spoilers=${show}`

export const communityApi = {
  feed: (filters: FeedFilters, signedIn: boolean, signal?: AbortSignal) => {
    const query = new URLSearchParams({ category: filters.category, media: filters.media, q: filters.q,
      sort: filters.sort, include_spoilers: String(filters.spoilers), offset: String(filters.offset) })
    if (!filters.category) query.delete('category')
    return request<CommunityFeed>(`/api/community/posts?${query}`, signal, signedIn)
  },
  create: (post: PostCreate) => request<CommunityPost>('/api/community/posts', undefined, true, json(post)),
  post: (id: string, spoilers: boolean, signedIn: boolean, signal?: AbortSignal) => request<CommunityPost>(`/api/community/posts/${encodeURIComponent(id)}${spoilerQuery(spoilers)}`, signal, signedIn),
  like: (id: string, liked: boolean, spoilers: boolean) => request<CommunityPost>(`/api/community/posts/${id}/like${spoilerQuery(spoilers)}`, undefined, true, json({ liked }, 'PUT')),
  comments: (id: string, spoilers: boolean, signal?: AbortSignal) => request<CommunityComment[]>(`/api/community/posts/${id}/comments${spoilerQuery(spoilers)}`, signal),
  comment: (id: string, body: string, contains_spoilers: boolean, show: boolean) => request<CommunityComment>(`/api/community/posts/${id}/comments${spoilerQuery(show)}`, undefined, true, json({ body, contains_spoilers })),
  presence: (visitor_id: string, page: PostCategory, signedIn: boolean, signal?: AbortSignal) => request<{ active_fans: number; window_seconds: number }>('/api/community/presence', signal, signedIn, json({ visitor_id, page })),
  library: (signal?: AbortSignal) => request<LibraryItem[]>('/api/community/library', signal, true),
}

export function visitorId(): string {
  const key = 'truefan.community.visitor'
  try {
    const saved = localStorage.getItem(key)
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved
    const id = crypto.randomUUID(); localStorage.setItem(key, id); return id
  } catch { return crypto.randomUUID() }
}

export function timeAgo(createdAt: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(createdAt)) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return new Date(createdAt).toLocaleDateString()
}

// Visible only when the API is unavailable, explicitly labeled as design examples.
export const examplePosts: CommunityPost[] = [
  { id: '00000000-0000-4000-8000-000000000001', author: 'Mika Chen', media: 'Kiki’s Delivery Service', title: 'Which anime world would you call home?', body: 'The bakery in Kiki’s Delivery Service has my heart. A cozy room, fresh bread, and a little magic. What’s your pick — and what would your everyday life look like there?' },
  { id: '00000000-0000-4000-8000-000000000002', author: 'OrbitOliver', media: 'Attack on Titan', title: 'An anime soundtrack that feels like floating through space', body: 'Revisited the Attack on Titan soundtrack today and somehow it still gives me goosebumps. Which anime opening or ending instantly takes you somewhere else? Building a playlist from your answers.' },
  { id: '00000000-0000-4000-8000-000000000003', author: 'Luna Reads', media: 'Natsume’s Book of Friends', title: 'Tell me your anime comfort-watch ritual ✦', body: 'Rain outside, a giant mug of tea, and Natsume’s Book of Friends on repeat. No better way to spend a Sunday. What are the little rituals that make your favorite anime feel like home?' },
].map((post, index) => ({ ...post, category: 'discussion', contains_spoilers: false, rating: null,
  created_at: new Date(Date.now() - (index + 1) * 20 * 60000).toISOString(), likes: 0, comments: 0, liked: false, example: true }))
