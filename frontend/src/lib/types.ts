// Keep in sync with backend/app/schemas.py; /openapi.json is the API contract.
export interface RevealPoint { unit: number }
export interface UserProgress { media_id: string; progress: RevealPoint }
export interface Media {
  id: string
  title: string
  type: 'anime' | 'tv' | 'manga' | 'game' | 'movie'
  progress_unit: 'episode' | 'chapter' | 'movie' | 'milestone'
  total_units: number
  description: string
  anilist_id: number | null
  has_prologue: boolean
  cover_url: string | null
  format: string | null
}
export interface Provenance { source: string; source_unit: number; verified: boolean; model: string | null; evidence: string | null; episode_number: number | null; source_title: string | null }
export interface Entity {
  id: string; name: string; type: 'character' | 'faction' | 'location' | 'object'
  description: string; revealed_at: RevealPoint; provenance: Provenance
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

export interface GenerationStatus {
  status: 'not_generated' | 'queued' | 'retrieving' | 'generating' | 'ready' | 'partial' | 'empty' | 'failed'
  processed_units: number; supported_units: number[]; episode_cap: number
  error: string | null; updated_at: string | null; experimental: boolean
}
export interface Universe {
  root_id: string; media: Media[]; relationships: { source: string; target: string; type: string }[]; truncated: boolean
}
