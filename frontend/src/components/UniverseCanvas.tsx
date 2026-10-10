import { Background, Controls, ReactFlow } from '@xyflow/react'
import type { Node, Edge } from '@xyflow/react'
import type { Media, Universe } from '../lib/types'

export default function UniverseCanvas({ universe, onSelect }: { universe: Universe; onSelect: (media: Media) => void }) {
  const nodes: Node[] = universe.media.map((media, index) => ({
    id: media.id, data: { label: `${media.title}${media.format ? ` (${media.format})` : ''}` },
    position: { x: (index % 4) * 250, y: Math.floor(index / 4) * 160 },
    style: { background: '#313244', border: '1px solid #b4befe', borderRadius: 10, padding: 14, color: '#cdd6f4' },
  }))
  const edges: Edge[] = universe.relationships.map((edge, index) => ({
    id: `media-edge-${index}`, source: edge.source, target: edge.target, label: edge.type.toLowerCase().replaceAll('_', ' '),
  }))
  return <div className="graph-canvas" aria-label="Media universe graph"><ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.1} fitViewOptions={{ padding: 0.15 }}
    nodesConnectable={false} nodesDraggable={false} onNodeClick={(_, node) => {
      const media = universe.media.find(item => item.id === node.id)
      if (media) onSelect(media)
    }}><Background gap={24} /><Controls showInteractive={false} /></ReactFlow></div>
}
