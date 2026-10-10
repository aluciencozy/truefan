import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BaseEdge, Handle, Panel, Position, ReactFlow } from '@xyflow/react'
import type { Edge, EdgeProps, Node, NodeProps, ReactFlowInstance } from '@xyflow/react'
import { motion, useReducedMotion } from 'motion/react'
import type { Media, Universe } from '../lib/types'
import { relationLabel } from '../lib/universeModel'
import type { UniverseModel } from '../lib/universeModel'
import { branchBounds, fallbackPositions, layoutUniverse, preservePositions, MEDIA_HEIGHT, MEDIA_WIDTH } from '../lib/universeLayout'
import type { Positions } from '../lib/universeLayout'
import { connectedNeighbors, directionalNeighbor, focusViewport } from '../lib/universeNavigation'
import type { ReleaseGuide } from '../lib/universeProgression'

type Destination = Node<{ media: Media; guide: ReleaseGuide; release: boolean; focused: boolean; nearby: boolean; overview: boolean; onFocus: (id: string) => void }, 'destination'>
const DestinationNode = memo(function DestinationNode({ data }: NodeProps<Destination>) {
  const reduced = useReducedMotion()
  const { media, guide, focused, release } = data
  return <div role="button" tabIndex={data.nearby || data.overview ? 0 : -1} title={media.title} aria-label={`${media.title}, ${guide.status}`} aria-current={focused ? 'true' : undefined}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onFocus(media.id) } }}
    className={`destination ${guide.status} ${focused ? 'focused' : ''} ${data.nearby || data.overview ? '' : 'remote'}`}>
    <Handle type="target" position={Position.Left} />
    <motion.div className="destination-orbit" initial={false}
      animate={{ scale: data.overview ? 1.45 : focused ? 1.7 : 1, opacity: data.nearby || data.overview ? 1 : .28 }}
      transition={{ duration: reduced ? 0 : .75, ease: [.22, 1, .36, 1] }}>
      <div className="destination-art">
        {media.cover_url ? <img src={media.cover_url} alt="" loading="lazy" draggable={false} /> : <span aria-hidden="true">✦</span>}
      </div>
      {focused && !reduced && <motion.span className="arrival-ring" key={media.id + String(data.overview)} initial={{ scale: .8, opacity: .8 }} animate={{ scale: 1.65, opacity: 0 }} transition={{ duration: 1.2 }} />}
      {guide.status === 'completed' && <span className="watched-badge" aria-label="Completed">✓</span>}
      {guide.status === 'locked' && <span className="lock-badge" aria-hidden="true">⌑</span>}
      {release && <span className="release-badge" title={`Branch ${guide.branchNumber}, release ${guide.number}`}>{guide.branchNumber}.{guide.number}</span>}
    </motion.div>
    <strong title={media.title}>{media.title}</strong>
    <span className="destination-state">{guide.status === 'locked' ? 'Locked' : guide.status === 'completed' ? 'Completed' : guide.suggested && release ? 'Suggested next' : 'Available'}</span>
    <Handle type="source" position={Position.Right} />
  </div>
})

type Region = Node<{ label: string }, 'region'>
function RegionNode({ data }: NodeProps<Region>) { return <div className="branch-region"><span>{data.label}</span></div> }

type Journey = { id: string; from: string; serial: number }
type OrbitEdge = Edge<{ incident: boolean; primary: boolean; label: string; journey: Journey | null }, 'orbit'>
const UniverseEdge = memo(function UniverseEdge({ id, source, sourceX, sourceY, targetX, targetY, data }: EdgeProps<OrbitEdge>) {
  const reduced = useReducedMotion()
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  const journey = data?.journey
  const travelPath = journey?.from === source ? path : `M ${targetX},${targetY} L ${sourceX},${sourceY}`
  return <g className={`orbit-edge ${data?.incident ? 'incident' : ''}`}>
    <BaseEdge id={id} path={path} interactionWidth={28} style={{ stroke: data?.incident ? '#b4befe' : '#6c7086', strokeWidth: data?.incident ? 1.5 : 1,
      strokeDasharray: data?.primary ? undefined : '4 9', opacity: data?.incident ? .65 : .25 }} />
    {data?.incident && data.label && <text x={(sourceX + targetX) / 2} y={(sourceY + targetY) / 2 - 12} textAnchor="middle" className="orbit-relation">{data.label}</text>}
    {journey && !reduced && <g key={journey.serial} className="journey-trail" aria-hidden="true">
      <motion.path d={travelPath} fill="none" stroke="#cba6f7" strokeWidth={4} initial={{ pathLength: 0, opacity: 1 }}
        animate={{ pathLength: 1, opacity: [1, 1, 0] }} transition={{ duration: 1.05, ease: [.65, 0, .35, 1] }} />
      <motion.circle r={4} fill="#f5e0dc" style={{ offsetPath: `path('${travelPath}')` }} initial={{ offsetDistance: '0%', opacity: 1 }}
        animate={{ offsetDistance: '100%', opacity: [1, 1, 0] }} transition={{ duration: 1.05, ease: [.65, 0, .35, 1] }} />
    </g>}
  </g>
})
const nodeTypes = { destination: DestinationNode, region: RegionNode }
const edgeTypes = { orbit: UniverseEdge }
const cameraEase = (t: number) => t * t * (3 - 2 * t)
const directions = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }

interface Props {
  universe: Universe; model: UniverseModel; guide: Record<string, ReleaseGuide>; focusedId: string; active: boolean
  release: boolean; onRelease: () => void; onFocus: (media: Media) => void
  onExpand: () => void; expanding: boolean; details: ReactNode
}

export default function UniverseCanvas({ universe, model, guide, focusedId, active, release, onRelease, onFocus, onExpand, expanding, details }: Props) {
  const reduced = useReducedMotion()
  const [positions, setPositions] = useState<Positions>({})
  const [layoutState, setLayoutState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [size, setSize] = useState({ width: 1000, height: 650 })
  const [overview, setOverview] = useState(false)
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null)
  const [journey, setJourney] = useState<Journey | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const anchors = useRef<Positions>({})
  const previousFocus = useRef(focusedId)
  const travelSerial = useRef(0)
  const mediaById = useMemo(() => new Map(model.media.map(item => [item.id, item])), [model])
  const neighbors = useMemo(() => connectedNeighbors(model, focusedId), [model, focusedId])
  const nearby = useMemo(() => new Set([focusedId, ...neighbors]), [focusedId, neighbors])
  const illuminated = useMemo(() => {
    const origin = positions[focusedId]
    const distance = (id: string) => origin && positions[id] ? Math.hypot(positions[id].x - origin.x, positions[id].y - origin.y) : Infinity
    return new Set(model.links.filter(link => link.source === focusedId || link.target === focusedId)
      .sort((a, b) => Number(b.primary) - Number(a.primary)
        || distance(a.source === focusedId ? a.target : a.source) - distance(b.source === focusedId ? b.target : b.source))
      .slice(0, 4).map(link => link.id))
  }, [model, focusedId, positions])

  useEffect(() => {
    let stale = false
    setLayoutState('loading')
    void layoutUniverse(model, anchors.current).then(next => {
      if (stale) return
      anchors.current = next; setPositions(next); setLayoutState('ready')
    }).catch(() => {
      if (stale) return
      const next = preservePositions(model, fallbackPositions(model), anchors.current)
      anchors.current = next; setPositions(next); setLayoutState('fallback')
    })
    return () => { stale = true }
  }, [model])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width && height) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const from = previousFocus.current
    previousFocus.current = focusedId
    if (from === focusedId) return
    const link = model.links.find(item => (item.source === from && item.target === focusedId) || (item.target === from && item.source === focusedId))
    setJourney(link ? { id: link.id, from, serial: ++travelSerial.current } : null)
  }, [model, focusedId])

  useEffect(() => {
    if (!active || !flow || layoutState === 'loading') return
    const options = { duration: reduced ? 0 : 1050, ease: cameraEase, interpolate: 'linear' as const }
    if (overview) {
      void flow.fitView({ nodes: model.media.map(item => ({ id: item.id })), padding: .18, minZoom: .01, maxZoom: .85, ...options })
    } else if (positions[focusedId]) {
      // Linear viewport interpolation at a fixed focus zoom follows the straight connecting edge.
      void flow.setViewport(focusViewport(positions[focusedId], size.width, size.height), options)
    }
  }, [active, flow, positions, layoutState, overview, focusedId, size, reduced, model])

  const focus = useCallback((id: string) => {
    const media = mediaById.get(id)
    if (!media) return
    setOverview(false)
    onFocus(media)
  }, [mediaById, onFocus])

  const previous = model.links.find(link => link.target === focusedId && link.primary)?.source
    ?? directionalNeighbor(focusedId, neighbors, positions, directions.ArrowLeft)
  const next = model.links.find(link => link.source === focusedId && link.primary)?.target
    ?? directionalNeighbor(focusedId, neighbors, positions, directions.ArrowRight)
    ?? neighbors.find(id => id !== previous)

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
      const target = event.target as HTMLElement
      if (target.closest('input, select, textarea, [contenteditable="true"], [role="dialog"]')) return
      const direction = directions[event.key as keyof typeof directions]
      if (!direction) return
      event.preventDefault()
      const destination = directionalNeighbor(focusedId, neighbors, positions, direction)
        ?? (event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : undefined)
      if (destination) focus(destination)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, focusedId, neighbors, positions, previous, next, focus])

  const nodes = useMemo<Node[]>(() => [
    ...branchBounds(model, positions).map((b, index) => ({ id: b.id, type: 'region', position: { x: b.x, y: b.y },
      data: { label: `Branch ${index + 1}` }, style: { width: b.width, height: b.height },
      selectable: false, focusable: false, zIndex: -1 })),
    ...model.media.filter(m => positions[m.id]).map(media => ({
      id: media.id, type: 'destination', focusable: false, position: positions[media.id], width: MEDIA_WIDTH, height: MEDIA_HEIGHT,
      zIndex: focusedId === media.id ? 3 : 1,
      data: { media, guide: guide[media.id], release, focused: focusedId === media.id, nearby: nearby.has(media.id), overview, onFocus: focus },
      ariaLabel: `${media.title}, ${guide[media.id].status}. Select to explore this world.`,
    })),
  ], [model, positions, guide, release, focusedId, nearby, overview, focus])

  const edges = useMemo<OrbitEdge[]>(() => model.links.filter(link => link.source !== link.target).map(link => ({
    id: link.id, source: link.source, target: link.target, type: 'orbit', focusable: false,
    ariaLabel: `${relationLabel(link.kind)} connection. Travel to the connected world.`,
    data: { incident: overview || illuminated.has(link.id) || journey?.id === link.id, primary: link.primary,
      label: overview ? '' : link.kind === 'SEQUEL' && link.relations.some(r => r.type.toUpperCase() === 'PREQUEL') ? 'prequel / sequel' : relationLabel(link.kind),
      journey: journey?.id === link.id ? journey : null },
  })), [model, overview, illuminated, journey])

  return <div ref={container} className={`universe-canvas celestial ${overview ? 'overview-mode' : 'focus-mode'}`} aria-label="Anime universe canvas" aria-busy={layoutState === 'loading'}>
    <div className="universe-nebula" aria-hidden="true" />
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlow} proOptions={{ hideAttribution: true }}
      minZoom={.01} maxZoom={1.8} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false}
      panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
      preventScrolling selectionOnDrag={false} autoPanOnNodeFocus={false} autoPanOnNodeDrag={false}
      onEdgeClick={(_, edge) => focus(edge.source === focusedId ? edge.target : edge.target === focusedId ? edge.source : edge.target)}
      onNodeClick={(_, node) => focus(node.id)} colorMode="dark">
      <Panel position="top-left" className="canvas-toolbar">
        <button onClick={() => focus(universe.root_id)}>⌂ Home world</button>
        <button aria-pressed={release} onClick={onRelease}>Release guidance {release ? 'on' : 'off'}</button>
        {universe.cache?.can_expand && <button disabled={expanding} onClick={onExpand}>{expanding ? 'Exploring…' : 'Expand universe'}</button>}
      </Panel>
      <Panel position="top-right" className="overview-control">
        <button aria-label={overview ? 'Return to Focus Mode' : 'Show constellation overview'} aria-pressed={overview} onClick={() => setOverview(value => !value)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={overview ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
          </svg>{overview ? 'Back to focus' : 'Overview'}
        </button>
      </Panel>
      <Panel position="bottom-center" className="journey-navigation">
        <div className="journey-controls">
          <button disabled={!previous} onClick={() => previous && focus(previous)} title={previous ? mediaById.get(previous)?.title : 'No previous connection'}>← Previous</button>
          <span>{overview ? 'The whole constellation' : 'Travel the connections'}<small>{overview ? `${model.media.length} connected worlds` : 'Arrow keys or select a nearby world'}</small></span>
          <button disabled={!next} onClick={() => next && focus(next)} title={next ? mediaById.get(next)?.title : 'No next connection'}>Next →</button>
        </div>
      </Panel>
    </ReactFlow>
    {!overview && layoutState !== 'loading' && <motion.div key={focusedId} className="universe-inspector"
      initial={{ opacity: 0, x: reduced ? 0 : 18 }} animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduced ? 0 : .45, delay: reduced ? 0 : .35 }}>
      {details}
    </motion.div>}
    <div className="journey-announcement" role="status" aria-live="polite">{mediaById.get(focusedId)?.title}{overview ? ', Overview Mode' : ', Focus Mode'}</div>
    {layoutState === 'loading' && <div role="status" className="canvas-status">Mapping the universe…</div>}
    {layoutState === 'fallback' && <div role="status" className="canvas-status">Automatic layout unavailable. Showing branch lanes.</div>}
    {!model.media.length && <div className="canvas-status">No connected works discovered.</div>}
  </div>
}
