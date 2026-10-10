import { Background, Controls, ReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import type { Entity, GraphResponse } from '../lib/types'

const colors: Record<Entity['type'], string> = {
  character: '#313244', faction: '#45475a', location: '#313244', object: '#45475a',
}

export default function GraphCanvas({ graph, onSelect }: {
  graph: GraphResponse; onSelect: (id: string) => void
}) {
  const nodes: Node[] = graph.entities.map((entity, i) => ({
    id: entity.id, data: { label: entity.name },
    position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 200 + (i % 2) * 65 },
    style: { background: colors[entity.type], border: '1px solid #b4befe', borderRadius: 10, padding: 16, color: '#cdd6f4' },
  }))
  const edges: Edge[] = graph.relationships.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.label || edge.type,
    style: { stroke: '#a6adc8', strokeWidth: 2 },
  }))
  return <div className="graph-canvas" aria-label="Story knowledge graph">
    <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false}
      nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)}
      onSelectionChange={({ nodes }) => { if (nodes[0]) onSelect(nodes[0].id) }}>
      <Background color="#45475a" gap={24} /><Controls showInteractive={false} />
    </ReactFlow>
  </div>
}
