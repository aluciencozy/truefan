import { request } from './api'

export type PostCategory = 'discussion' | 'theory' | 'review'
export type RoomId = 'courtroom' | 'fanfiction' | 'drawing' | 'battle' | 'capsule' | 'ending' | 'mystery' | 'pitch' | 'verdict' | 'hot-take' | 'matchmaking'
export interface ForumRoom { id: RoomId; category: PostCategory; name: string; description: string; title: string; prompt: string }
export const forumRooms: ForumRoom[] = [
  {id:'courtroom',category:'discussion',name:'Character courtroom',description:'Choose a side, present scene evidence, and vote on a decision.',title:'Charlotte courtroom: put a character’s choice on trial',prompt:'Choose a decision from the episodes you have watched. Explain the case without revealing future events. Fans can join prosecution or defense and cite their evidence.'},
  {id:'fanfiction',category:'discussion',name:'Fanfiction',description:'Write a chapter or respond to a writing challenge.',title:'Charlotte: write a new day at Hoshinoumi Academy',prompt:'Imagine an ordinary school day in the world of Charlotte. Write a scene in your own voice and invite others to continue it.'},
  {id:'drawing',category:'discussion',name:'Fan art & drawing',description:'Share artwork or join a drawing challenge.',title:'Charlotte drawing challenge: your favorite character',prompt:'Draw a character in your own style. Share a sketch or a finished piece and tell us what inspired it. Keep future story details marked as spoilers.'},
  {id:'battle',category:'theory',name:'Theory battles',description:'Two explanations, two evidence boards.',title:'Charlotte theory battle: what explains the mystery?',prompt:'Set out two competing explanations based on the episodes you have watched. Give each side a name, then invite fans to contribute clues.'},
  {id:'capsule',category:'theory',name:'Prediction time capsules',description:'Write, lock, then reveal after watching.',title:'Charlotte: predict the next episode',prompt:'Before watching your next episode, write a prediction. Lock it when you are ready. After watching, reveal it and compare what happened.'},
  {id:'ending',category:'theory',name:'Alternate-ending challenges',description:'Change one choice and vote on alternate outcomes.',title:'Charlotte: change one decision—what happens next?',prompt:'Pick one decision from an episode you have watched and write an alternate outcome. Explain why it fits the characters. Mark any plot details as spoilers.'},
  {id:'mystery',category:'theory',name:'Community mystery board',description:'Connect characters, events, and clues.',title:'Charlotte detective board: connect the clues',prompt:'Pin a clue with its episode reference. Connect it to another clue and explain the link. Use only material within this thread’s story scope.'},
  {id:'pitch',category:'review',name:'Convince me to watch',description:'Three spoiler-free sentences and a watchlist shortcut.',title:'Convince me to watch Charlotte in three sentences',prompt:'Sell the mood, characters, or style of Charlotte in no more than three spoiler-free sentences.'},
  {id:'verdict',category:'review',name:'First impression → final verdict',description:'Record your early thoughts and revisit them later.',title:'Charlotte: how did your first impression change?',prompt:'Record your first impression with the episode you have reached. Return later and add a final verdict. Mark finished-series details as spoilers.'},
  {id:'hot-take',category:'review',name:'Hot-take courtroom',description:'Argue for or against a take, then vote.',title:'Charlotte hot take: the characters make the show',prompt:'Make a case for or against this take. Add scene evidence from the episodes you have watched and let the community vote.'},
  {id:'matchmaking',category:'review',name:'Watchlist matchmaking',description:'Ask for recommendations and mark what you tried.',title:'What should I watch alongside Charlotte?',prompt:'Tell fans what mood, characters, or themes you want. Nominate a show and explain your pick without spoilers. The requester can mark recommendations they tried.'},
]
export interface EntryDraft { board_x?: number | null; board_y?: number | null; shape?: 'rectangle' | 'circle' | 'diamond'; kind: 'contribution' | 'join' | 'vote' | 'prediction' | 'clue' | 'art' | 'recommendation' | 'impression'; body: string; side: 'a' | 'b' | 'believable' | 'devastating' | 'neutral'; source: string; artwork: string; connects_to: string | null; contains_spoilers: boolean }
export interface ForumEntry extends EntryDraft { id: string; author: string; created_at: string; is_owner: boolean; locked: boolean; revealed: boolean; tried: boolean }
export interface CommunityPost {
  image?: string; id: string; category: PostCategory; media: string; title: string; body: string
  author: string; created_at: string; contains_spoilers: boolean; rating: number | null
  likes: number; comments: number; liked: boolean; example: boolean
  room?: RoomId | null; side_a?: string; side_b?: string; target_episode?: number; is_owner?: boolean
}
export interface CommunityComment {
  image?: string; editable_until?: string; parent_id?: string | null; reply_to_author?: string | null;
  is_owner?: boolean; id: string; author: string; body: string; contains_spoilers: boolean; created_at: string
}
export interface CommunityFeed { posts: CommunityPost[]; media: string[]; active_fans: number; has_more: boolean }
export interface PostCreate {
  image?: string;
  room?: RoomId | null; side_a?: string; side_b?: string; target_episode?: number;
  category: PostCategory; media: string; title: string; body: string; contains_spoilers: boolean; rating: number | null
}
export interface LibraryItem { media_id: string; title: string; completed: boolean }
export interface FeedFilters { room?: RoomId | ''; category: PostCategory | ''; media: string; q: string; sort: 'latest' | 'popular'; spoilers: boolean; offset: number }

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const spoilerQuery = (show: boolean) => `?include_spoilers=${show}`

export const communityApi = {
  feed: (filters: FeedFilters, signedIn: boolean, signal?: AbortSignal) => {
    const query = new URLSearchParams({ category: filters.category, media: filters.media, q: filters.q,
      sort: filters.sort, include_spoilers: String(filters.spoilers), offset: String(filters.offset) })
    if (!filters.category) query.delete('category')
    if (filters.room) query.set('room', filters.room)
    return request<CommunityFeed>(`/api/community/posts?${query}`, signal, signedIn)
  },
  create: (post: PostCreate) => request<CommunityPost>('/api/community/posts', undefined, true, json(post)),
  post: (id: string, spoilers: boolean, signedIn: boolean, signal?: AbortSignal) => request<CommunityPost>(`/api/community/posts/${encodeURIComponent(id)}${spoilerQuery(spoilers)}`, signal, signedIn),
  like: (id: string, liked: boolean, spoilers: boolean) => request<CommunityPost>(`/api/community/posts/${id}/like${spoilerQuery(spoilers)}`, undefined, true, json({ liked }, 'PUT')),
  comments: (id: string, spoilers: boolean, signal?: AbortSignal, signedIn=false) => request<CommunityComment[]>(`/api/community/posts/${id}/comments${spoilerQuery(spoilers)}`, signal, signedIn),
  comment: (id: string, body: string, contains_spoilers: boolean, show: boolean, parent_id: string | null = null, image = '') => request<CommunityComment>(`/api/community/posts/${id}/comments${spoilerQuery(show)}`, undefined, true, json({ body, contains_spoilers, parent_id, image })),
  update: (id: string, post: PostCreate) => request<CommunityPost>(`/api/community/posts/${id}`, undefined, true, json(post, 'PUT')),
  remove: (id: string) => request<{deleted: boolean}>(`/api/community/posts/${id}`, undefined, true, {method:'DELETE'}),
  editComment: (id: string, body: string, contains_spoilers: boolean, image = '') => request<CommunityComment>(`/api/community/comments/${id}`, undefined, true, json({body,contains_spoilers,image}, 'PUT')),
  removeComment: (id: string) => request<{deleted: boolean}>(`/api/community/comments/${id}`, undefined, true, {method:'DELETE'}),
  entries: (id: string, spoilers: boolean, signedIn: boolean, signal?: AbortSignal) => request<ForumEntry[]>(`/api/community/posts/${id}/entries${spoilerQuery(spoilers)}`, signal, signedIn),
  saveEntry: (id: string, draft: EntryDraft, spoilers: boolean, entryId?: string) => request<ForumEntry>(`/api/community/posts/${id}/entries${entryId ? '/' + entryId : ''}${spoilerQuery(spoilers)}`, undefined, true, json(draft, entryId ? 'PUT' : 'POST')),
  removeEntry: (id: string) => request<{deleted: boolean}>(`/api/community/entries/${id}`, undefined, true, {method:'DELETE'}),
  entryAction: (id: string, action: 'lock' | 'reveal' | 'tried', spoilers=false) => request<ForumEntry>(`/api/community/entries/${id}/action${spoilerQuery(spoilers)}`, undefined, true, json({action})),
  saveCharlotte: async () => {
    const matches = await request<{id:string; title:string}[]>('/api/media/search?q=Charlotte')
    const match = matches.find(item => item.title.toLowerCase() === 'charlotte')
    if (!match) throw new Error('Charlotte could not be found. Try again later.')
    const [state] = await request<{completed:boolean}[]>(`/api/me/media-state?media_id=${encodeURIComponent(match.id)}`, undefined, true)
    return request<unknown>(`/api/me/media-state/${match.id}`, undefined, true, json({completed:state?.completed ?? false}, 'PUT'))
  },
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

// Templates are never represented as real fan activity or fabricated counts.
export const examplePosts: CommunityPost[] = forumRooms.map((room,index) => ({
  id: `00000000-0000-4000-8000-${String(index+100).padStart(12,'0')}`, category:room.category, room:room.id,
  media:'Charlotte', title:room.title, body:room.prompt, author:'TrueFan starter topic',
  created_at:'2026-01-01T00:00:00Z', contains_spoilers:false, rating:null,
  side_a:room.id==='battle'?'Theory A':room.id==='hot-take'?'For':'Prosecution',
  side_b:room.id==='battle'?'Theory B':room.id==='hot-take'?'Against':'Defense',target_episode:1,
  likes:0, comments:0, liked:false, example:true, is_owner:false,
}))
