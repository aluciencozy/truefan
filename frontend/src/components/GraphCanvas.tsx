import { Background, Controls, ReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import type { Entity, GraphResponse } from '../lib/types'

const colors: Record<Entity['type'], string> = {
  character: '#e1eef7', faction: '#eae4f5', location: '#dceee8', object: '#f8e9cb',
}

export default function GraphCanvas({ graph, onSelect }: {
  graph: GraphResponse; onSelect: (id: string) => void
}) {
  const nodes: Node[] = graph.entities.map((entity, i) => ({
    id: entity.id, data: { label: entity.name },
    position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 200 + (i % 2) * 65 },
    style: { background: colors[entity.type], border: '1px solid #7891a0', borderRadius: 10, padding: 16, color: '#173e53' },
  }))
  const edges: Edge[] = graph.relationships.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.label || edge.type,
    style: { stroke: '#648299', strokeWidth: 2 },
  }))
  return <div className="graph-canvas" aria-label="Story knowledge graph">
    <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false}
      nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)}
      onSelectionChange={({ nodes }) => { if (nodes[0]) onSelect(nodes[0].id) }}>
      <Background color="#c1d1db" gap={24} /><Controls showInteractive={false} />
    </ReactFlow>
  </div>
}
