// Keep in sync with backend/app/schemas.py; /openapi.json is the API contract.
export interface RevealPoint { unit: number }
export interface UserProgress { media_id: string; progress: RevealPoint }
export interface MediaReleaseDate { year: number | null; month: number | null; day: number | null }
export interface TrendingCover { id: number; cover_url: string }
export interface UserMediaState {
  media_id: string; progress: RevealPoint | null; completed: boolean; manual_unlocked: boolean
}
export interface Media {
  id: string
  title: string
  type: 'anime' | 'tv' | 'manga' | 'game' | 'movie'
  progress_unit: 'episode' | 'chapter' | 'movie' | 'milestone'
  total_units: number
  total_units_known?: boolean
  release_date?: MediaReleaseDate | null
  description: string
  anilist_id: number | null
  has_prologue: boolean
  cover_url: string | null
  format: string | null
}
// Mirrors GET /api/trending/constellations: titles, covers, format/year and counts only (no synopses, no user data).
export interface TrendingStar { media_id: string; title: string; cover_url: string | null; format: string | null; year: number | null; completions: number; magnitude: number; trending: boolean; trending_rank: number | null }
export interface TrendingLink { source: string; target: string; type: string }
export interface TrendingConstellation { franchise_id: string; title: string; entry_media_id: string; score: number; trending_rank: number | null; stars: TrendingStar[]; links: TrendingLink[] }
export interface TrendingConstellations { source: 'anilist_trending' | 'truefan_completions'; window_days: number; constellations: TrendingConstellation[] }
// Mirrors GET /api/media/surprise; media.description is always blank for this endpoint.
export interface SurprisePick { media: Media; start_progress: number; hook: string; tags: string[]; characters_at_start: number; pool_size: number }
export interface Provenance { source: string; source_unit: number; verified: boolean; model: string | null; evidence: string | null; episode_number: number | null; source_title: string | null }
export interface Entity {
  id: string; name: string; type: 'character' | 'faction' | 'location' | 'object'
  description: string; revealed_at: RevealPoint; provenance: Provenance
  portrait_url?: string | null; portrait_large_url?: string | null
}
export interface Relationship {
  id: string; source: string; target: string; type: string; label: string | null
  revealed_at: RevealPoint; provenance: Provenance
}
export interface GraphResponse {
  experimental: boolean; generation: GenerationStatus | null
  media_id: string; progress: RevealPoint
  entities: Entity[]; relationships: Relationship[]
}
export interface CurrentUser { id: string }
export interface HealthResponse { status: 'ok'; mode: 'demo' }
export interface ExtractRequest {
  media_id: string; summary: string; source: string; reveal_point: RevealPoint
}
export interface AskRequest extends UserProgress { question: string }
export interface PlaceholderResponse { status: 'not_implemented'; message: string }
export interface GraphExtractRequest {
  summary: string; source: string; reveal_point: RevealPoint; progress: RevealPoint
}
export interface FlowItemData { revealed_at: RevealPoint; provenance: Provenance }
export interface FlowNode {
  id: string; position: { x: number; y: number }
  data: FlowItemData & { label: string; entity_type: string; description: string }
}
export interface FlowEdge { id: string; source: string; target: string; label: string; data: FlowItemData }
// origin: "ai" is unverified model output; "database"/"builtin" are the curated fallback graph.
export interface FlowGraphResponse {
  media_id: string; progress: RevealPoint; origin: 'ai' | 'database' | 'builtin'
  nodes: FlowNode[]; edges: FlowEdge[]
}

export interface GenerationStatus {
  status: 'not_generated' | 'queued' | 'retrieving' | 'generating' | 'ready' | 'partial' | 'empty' | 'failed'
  processed_units: number; supported_units: number[]; episode_cap: number
  error: string | null; updated_at: string | null; experimental: boolean
}
export interface UniverseCache {
  refreshed_at: string | null; stale: boolean; incomplete: boolean; revision: number
  can_expand: boolean; limitations: string[]
}
export interface UniverseRelation { source: string; target: string; type: string }
export interface Universe {
  root_id: string; media: Media[]; relationships: UniverseRelation[]; truncated: boolean
  franchise_id?: string | null; cache?: UniverseCache | null
}

export interface UniverseSearchResult {
  franchise_id: string; title: string; entry_media_id: string; cover_url: string | null
}
export interface UniverseSearchResponse { results: UniverseSearchResult[]; auto_open: boolean }
