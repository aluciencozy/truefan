import { useMemo } from 'react'
import type { GraphResponse } from '../lib/types'
import { constellationLayout } from '../lib/constellation'
import Constellation, { type StarNode } from './Constellation'

export default function GraphCanvas({ graph, onSelect, selectedId }: {
  graph: GraphResponse; onSelect: (id: string | null) => void; selectedId: string | null
}) {
  const nodes = useMemo<StarNode[]>(() => {
    const positions = constellationLayout(graph.entities.map(entity => entity.id), graph.relationships)
    return graph.entities.map(entity => ({ id: entity.id, type: 'star', position: positions.get(entity.id)!,
      data: { label: entity.name, subtitle: entity.type, kind: entity.type, portraitUrl: entity.portrait_url }, ariaLabel: `Explore ${entity.name}` }))
  }, [graph])
  const edges = useMemo(() => {
    const kinds = new Map(graph.entities.map(entity => [entity.id, entity.type]))
    return graph.relationships.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
      type: 'straight', className: `story-edge ${kinds.get(edge.source) ?? 'character'} ${selectedId && (edge.source === selectedId || edge.target === selectedId) ? 'highlight-edge' : ''}`,
    }))
  }, [graph, selectedId])
  return <Constellation nodes={nodes} edges={edges} onSelect={onSelect} selectedId={selectedId} label="Story knowledge graph" />
}
