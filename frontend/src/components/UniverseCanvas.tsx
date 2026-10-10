import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow, useStore } from '@xyflow/react'
import type { Edge, Node, NodeProps, ReactFlowInstance } from '@xyflow/react'
import type { Media, Universe } from '../lib/types'
import { relationLabel } from '../lib/universeModel'
import type { UniverseModel } from '../lib/universeModel'
import { branchBounds, fallbackPositions, layoutUniverse, preservePositions, MEDIA_HEIGHT, MEDIA_WIDTH } from '../lib/universeLayout'
import type { Positions } from '../lib/universeLayout'
import type { ReleaseGuide } from '../lib/universeProgression'

type Destination = Node<{ media: Media; guide: ReleaseGuide; release: boolean; focused: boolean; onFocus: (media: Media) => void }, 'destination'>
const DestinationNode = memo(function DestinationNode({ data }: NodeProps<Destination>) {
  const distant = useStore(state => state.transform[2] < 0.48)
  const { media, guide, focused, release } = data
  return <div role="button" tabIndex={0} aria-label={`${media.title}, ${guide.status}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onFocus(media) } }} className={`destination ${guide.status} ${focused ? 'focused' : ''} ${distant ? 'distant' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="destination-orbit"><div className="destination-art">
      {media.cover_url ? <img src={media.cover_url} alt="" loading="lazy" draggable={false} /> : <span aria-hidden="true">✦</span>}
    </div>{guide.status === 'completed' && <span className="watched-badge" aria-label="Completed">✓</span>}
      {release && <span className="release-badge" title={`Branch ${guide.branchNumber}, release ${guide.number}`}>{guide.branchNumber}.{guide.number}</span>}
    </div>
    <strong title={media.title}>{media.title}</strong>
    <span className="destination-state">{guide.status === 'locked' ? 'Locked' : guide.status === 'completed' ? 'Completed' : guide.suggested && release ? 'Suggested next' : 'Available'}</span>
    <Handle type="source" position={Position.Right} />
  </div>
})
type Region = Node<{ label: string }, 'region'>
function RegionNode({ data }: NodeProps<Region>) { return <div className="branch-region"><span>{data.label}</span></div> }
const nodeTypes = { destination: DestinationNode, region: RegionNode }
const defaultEdgeOptions = { type: 'default', interactionWidth: 20 }
const duration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650

interface Props {
  universe: Universe; model: UniverseModel; guide: Record<string, ReleaseGuide>; focusedId: string
  release: boolean; onRelease: () => void; onFocus: (media: Media) => void; onEnter: (media: Media) => void
  onExpand: () => void; expanding: boolean
}

export default function UniverseCanvas({ universe, model, guide, focusedId, release, onRelease, onFocus, onEnter, onExpand, expanding }: Props) {
  const [positions, setPositions] = useState<Positions>({})
  const [layoutState, setLayoutState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [zoom, setZoom] = useState(1)
  const [selectedLink, setSelectedLink] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const focusRef = useRef(focusedId)
  focusRef.current = focusedId
  const flow = useRef<ReactFlowInstance | null>(null)
  const anchors = useRef<Positions>({})
  const fitted = useRef(false)

  useEffect(() => {
    let stale = false
    setLayoutState('loading')
    void layoutUniverse(model, anchors.current).then(next => {
      if (stale) return
      anchors.current = next; setPositions(next); setLayoutState('ready')
    }).catch(() => {
      if (stale) return
      const next = preservePositions(model, fallbackPositions(model), anchors.current); anchors.current = next; setPositions(next); setLayoutState('fallback')
    })
    return () => { stale = true }
  }, [model])

  useEffect(() => {
    if (layoutState !== 'loading' && flow.current && !fitted.current) {
      fitted.current = true
      const timer = setTimeout(() => {
        const home = anchors.current[universe.root_id]
        const neighbors = model.links.filter(link => link.source === universe.root_id || link.target === universe.root_id)
          .map(link => link.source === universe.root_id ? link.target : link.source)
        const nearest = [...new Set(neighbors)].filter(id => anchors.current[id])
          .sort((a, b) => {
            const pa = anchors.current[a], pb = anchors.current[b]
            return home ? Math.hypot(pa.x - home.x, pa.y - home.y) - Math.hypot(pb.x - home.x, pb.y - home.y) : 0
          }).slice(0, 4)
        void flow.current?.fitView({ nodes: [universe.root_id, ...nearest].map(id => ({ id })), padding: 0.25, minZoom: 0.12, maxZoom: 0.85, duration: duration() })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [layoutState, universe.root_id, model])

  useEffect(() => {
    let previousWidth = 0
    let timer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (!width) return
      if (previousWidth && Math.abs(width - previousWidth) > 20) {
        clearTimeout(timer)
        timer = setTimeout(() => {
          const point = anchors.current[focusRef.current]
          if (point && flow.current) void flow.current.setCenter(point.x + MEDIA_WIDTH / 2, point.y + MEDIA_HEIGHT / 2, { zoom: flow.current.getZoom(), duration: duration() })
        }, 50)
      }
      previousWidth = width
    })
    if (container.current) observer.observe(container.current)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const point = anchors.current[focusedId]
    if (point && flow.current) void flow.current.setCenter(point.x + MEDIA_WIDTH / 2, point.y + MEDIA_HEIGHT / 2, { zoom: Math.max(0.85, flow.current.getZoom()), duration: duration() })
  }, [focusedId])

  function focus(id: string) {
    const position = positions[id]
    const media = model.media.find(item => item.id === id)
    if (!position || !media) return
    onFocus(media)
    void flow.current?.setCenter(position.x + MEDIA_WIDTH / 2, position.y + MEDIA_HEIGHT / 2, { zoom: Math.max(0.85, flow.current.getZoom()), duration: duration() })
  }

  const nodes = useMemo<Node[]>(() => {
    const bounds = branchBounds(model, positions)
    return [
      ...bounds.map((b, index) => ({ id: b.id, type: 'region', position: { x: b.x, y: b.y },
        data: { label: `Branch ${index + 1} · inferred grouping` }, style: { width: b.width, height: b.height },
        selectable: false, focusable: false, zIndex: -1 })),
      ...model.media.filter(m => positions[m.id]).map(media => ({
        id: media.id, type: 'destination', focusable: false, position: positions[media.id], width: MEDIA_WIDTH, height: MEDIA_HEIGHT,
        data: { media, guide: guide[media.id], release, focused: focusedId === media.id, onFocus },
        ariaLabel: `${media.title}, ${guide[media.id].status}. Select to focus; use Enter anime in the details panel.`,
      })),
    ]
  }, [model, positions, guide, release, focusedId, onFocus])

  const edges = useMemo<Edge[]>(() => model.links.filter(l => l.source !== l.target).map(link => {
    const incident = (link.primary && (link.source === focusedId || link.target === focusedId)) || selectedLink === link.id
    // Label a sequel-oriented reciprocal pair honestly; raw source/type/target appears in details.
    const label = link.kind === 'SEQUEL' ? link.relations.some(r => r.type.toUpperCase() === 'PREQUEL') ? 'prequel / sequel' : 'sequel' : relationLabel(link.kind)
    return { id: link.id, source: link.source, target: link.target,
      label: (zoom > 0.65 && link.primary) || selectedLink === link.id ? label : undefined,
      ariaLabel: `${label} connection. Select to show its label.`,
      markerEnd: link.directional ? { type: MarkerType.ArrowClosed, color: incident ? '#cba6f7' : '#7f849c', width: 16, height: 16 } : undefined,
      style: { stroke: incident ? '#cba6f7' : link.primary ? '#9399b2' : '#585b70', strokeWidth: incident ? 2 : link.primary ? 1.3 : 1, strokeDasharray: link.primary ? undefined : '5 6', opacity: incident ? 1 : link.primary ? 0.7 : 0.35 },
      labelStyle: { fontSize: 11 }, labelBgPadding: [7, 4], labelBgBorderRadius: 5,
    }
  }), [model, focusedId, zoom, selectedLink])

  return <div ref={container} className="universe-canvas" aria-label="Anime universe canvas" aria-busy={layoutState === 'loading'}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultEdgeOptions={defaultEdgeOptions}
      onInit={instance => { flow.current = instance }} minZoom={0.08} maxZoom={1.8} nodesConnectable={false} nodesDraggable={false}
      onEdgeClick={(_, edge) => setSelectedLink(edge.id)} zoomOnDoubleClick={false} onNodeClick={(_, node) => focus(node.id)}
      onNodeDoubleClick={(_, node) => { const media = model.media.find(m => m.id === node.id); if (media && guide[media.id]?.status !== 'locked') onEnter(media) }}
      onMoveEnd={(_, viewport) => setZoom(viewport.zoom)} colorMode="dark">
      <Background gap={34} size={1} color="#45475a" />
      <Controls showInteractive={false} fitViewOptions={{ padding: 0.18, duration: duration() }} />
      <MiniMap nodeColor={node => node.type === 'region' ? '#313244' : guide[node.id]?.status === 'completed' ? '#a6e3a1' : '#cba6f7'}
        nodeStrokeWidth={0} pannable zoomable maskColor="#181825b8" ariaLabel="Universe overview" />
      <Panel position="top-left" className="canvas-toolbar">
        <button onClick={() => focus(universe.root_id)}>Return home</button>
        <button aria-pressed={release} onClick={onRelease}>Release guidance {release ? 'on' : 'off'}</button>
        {universe.cache?.can_expand && <button disabled={expanding} onClick={onExpand}>{expanding ? 'Exploring…' : 'Expand universe'}</button>}
      </Panel>
      <Panel position="bottom-center" className="canvas-legend">Solid: primary sequel link · Dashed: other connections · Select a link for its label</Panel>
    </ReactFlow>
    {layoutState === 'loading' && <div role="status" className="canvas-status">Mapping the universe…</div>}
    {layoutState === 'fallback' && <div role="status" className="canvas-status">Automatic layout unavailable. Showing branch lanes.</div>}
    {!model.media.length && <div className="canvas-status">No connected works discovered.</div>}
  </div>
}
