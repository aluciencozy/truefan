import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useNodesInitialized } from '@xyflow/react'
import type { Edge, EdgeProps, Node, NodeProps, Viewport } from '@xyflow/react'
import { useReducedMotion } from 'motion/react'
import { canvasLimits } from '../lib/canvasLimits'
import { CanvasPointerContext, useCanvasParallax } from '../lib/useCanvasParallax'
import CharacterPortrait from './CharacterPortrait'
import PointerEdge from './PointerEdge'

export type StarNode = Node<{ label: string; subtitle: string; kind?: string; portraitUrl?: string | null; active?: boolean; preview?: boolean; onActivate?: (id: string) => void }, 'star'>
const Star = memo(function Star({ id, data }: NodeProps<StarNode>) {
  return <div className={`star-node ${data.kind || ''} ${data.active ? 'is-selected' : ''} ${data.preview ? 'route-preview' : ''}`} role="button" tabIndex={0}
    aria-label={`Explore ${data.label}`} aria-pressed={data.active}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onActivate?.(id) } }}>
    <Handle type="target" position={Position.Top} />
    <div className="star-portrait" aria-hidden="true"><CharacterPortrait name={data.label} src={data.portraitUrl} /></div>
    <strong>{data.label}</strong><small>{data.subtitle}</small>
    <Handle type="source" position={Position.Bottom} />
  </div>
})
const nodeTypes = { star: Star }
const edgeTypes = { straight: (props: EdgeProps) => <PointerEdge {...props} /> }

function Camera({ nodes, selectedId }: { nodes: StarNode[]; selectedId?: string | null }) {
  const { fitView, setCenter, getViewport, setViewport } = useReactFlow()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  const ready = useNodesInitialized()
  const reduced = useReducedMotion()
  const previous = useRef<string | null>(null)
  const overview = useRef<Viewport | null>(null)
  useEffect(() => {
    if (!ready || !width || !height) return
    const timer = setTimeout(() => {
    const selected = nodes.find(node => node.id === selectedId)
    const duration = reduced ? 0 : 650
    if (selected) {
      if (!previous.current) overview.current = getViewport()
      const mobile = window.matchMedia('(max-width: 700px)').matches
      const zoom = Math.min(1.25, width / (mobile ? 350 : 650))
      void setCenter(selected.position.x + 85 + (mobile ? 0 : width * .25 / zoom), selected.position.y + 52 + (mobile ? height * .27 / zoom : 0), { zoom, duration })
    } else if (previous.current && overview.current) {
      void setViewport(overview.current, { duration })
    } else void fitView({ padding: .3, maxZoom: 1.1, duration })
    previous.current = selectedId ?? null
    }, 50)
    return () => clearTimeout(timer)
  }, [nodes, selectedId, width, height, ready, reduced, fitView, setCenter, getViewport, setViewport])
  return null
}

export default function Constellation({ nodes, edges, selectedId, onSelect, label }: {
  nodes: StarNode[]; edges: Edge[]; selectedId?: string | null; onSelect: (id: string) => void; label: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const pointer = useCanvasParallax(container)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const hoveredEdge = edges.find(edge => edge.id === hoveredEdgeId)
  const [size, setSize] = useState({ width: 1000, height: 650 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const limits = useMemo(() => canvasLimits(nodes.map(node => node.position), 170, 160, size.width, size.height), [nodes, size])
  const interactiveNodes = useMemo(() => nodes.map(node => ({ ...node, width: 170, height: 160, focusable: false,
    data: { ...node.data, active: node.id === selectedId, preview: node.id === hoveredEdge?.source || node.id === hoveredEdge?.target, onActivate: onSelect } })), [nodes, selectedId, onSelect, hoveredEdge])
  return <div ref={container} className="graph-canvas celestial" aria-label={label}>
    <CanvasPointerContext.Provider value={pointer}><ReactFlowProvider><ReactFlow nodes={interactiveNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} proOptions={{ hideAttribution: true }}
      minZoom={limits.minZoom} maxZoom={1.8} translateExtent={limits.extent} fitViewOptions={{ padding: .3, maxZoom: 1.1 }}
      nodesDraggable={false} nodesConnectable={false} zoomOnDoubleClick={false}
      onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)} onEdgeMouseLeave={() => setHoveredEdgeId(null)}
      onNodeClick={(_, node) => onSelect(node.id)}>
      <Camera nodes={nodes} selectedId={selectedId} />
      <Controls showInteractive={false} orientation="horizontal" position="bottom-left" fitViewOptions={{ padding: .3, maxZoom: 1.1 }} />
    </ReactFlow></ReactFlowProvider></CanvasPointerContext.Provider>
  </div>
}
