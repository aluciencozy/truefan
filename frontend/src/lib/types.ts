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
}
export interface Provenance { source: string; source_unit: number; verified: boolean }
export interface Entity {
  id: string; name: string; type: 'character' | 'faction' | 'location' | 'object'
  description: string; revealed_at: RevealPoint; provenance: Provenance
}
export interface Relationship {
  id: string; source: string; target: string; type: string
  revealed_at: RevealPoint; provenance: Provenance
}
export interface GraphResponse {
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
