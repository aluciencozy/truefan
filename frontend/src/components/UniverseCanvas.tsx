import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Handle, Panel, Position, ReactFlow } from '@xyflow/react'
import type { Edge, EdgeProps, Node, NodeProps, ReactFlowInstance } from '@xyflow/react'
import { motion, useReducedMotion } from 'motion/react'
import type { Media, Universe } from '../lib/types'
import { relationLabel } from '../lib/universeModel'
import type { UniverseModel } from '../lib/universeModel'
import { groupBounds, fallbackPositions, layoutUniverse, preservePositions, MEDIA_HEIGHT, MEDIA_WIDTH } from '../lib/universeLayout'
import type { Positions } from '../lib/universeLayout'
import { connectedNeighbors, connectionDestination, directionalNeighbor, focusViewport } from '../lib/universeNavigation'
import type { ReleaseGuide } from '../lib/universeProgression'
import { worldTitle } from '../lib/universeProgression'
import { CanvasPointerContext, useCanvasParallax } from '../lib/useCanvasParallax'
import PointerEdge from './PointerEdge'

type Destination = Node<{ media: Media; guide: ReleaseGuide; release: boolean; focused: boolean; nearby: boolean; overview: boolean; preview: boolean; onFocus: (id: string) => void; onPreview: (id: string | null) => void }, 'destination'>
const DestinationNode = memo(function DestinationNode({ data }: NodeProps<Destination>) {
  const reduced = useReducedMotion()
  const { media, guide, focused, release } = data
  const title = worldTitle(media, guide)
  return <div role="button" tabIndex={data.nearby || data.overview ? 0 : -1} title={title} aria-label={`${title}, ${guide.status}`} aria-current={focused ? 'true' : undefined}
    onFocus={() => data.onPreview(media.id)} onBlur={() => data.onPreview(null)}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onFocus(media.id) } }}
    className={`destination ${guide.status} ${focused ? 'focused' : ''} ${data.preview ? 'route-preview' : ''} ${data.nearby || data.overview ? '' : 'remote'}`}>
    <Handle type="target" position={Position.Left} />
    <motion.div className="destination-orbit" initial={false}
      animate={{ scale: data.overview ? 1.45 : focused ? 2.35 : 1.15, opacity: data.nearby || data.overview ? 1 : .55 }}
      transition={{ duration: reduced ? 0 : .75, ease: [.22, 1, .36, 1] }}>
      <div className="destination-art">
        {media.cover_url ? <img src={focused ? media.cover_url.replace('anilistcdn/media/anime/cover/small/', 'anilistcdn/media/anime/cover/large/') : media.cover_url} alt="" loading="lazy"
          onError={event => { if (event.currentTarget.src !== media.cover_url) event.currentTarget.src = media.cover_url! }} draggable={false} /> : <span aria-hidden="true">✦</span>}
      </div>
      {focused && !reduced && <motion.span className="arrival-ring" key={media.id + String(data.overview)} initial={{ scale: .8, opacity: .8 }} animate={{ scale: 1.65, opacity: 0 }} transition={{ duration: 1.2 }} />}
      {guide.status === 'completed' && <span className="watched-badge" aria-label="Completed">✓</span>}
      {guide.status === 'locked' && <span className="lock-badge" aria-hidden="true">⌑</span>}
      {release && <span className="release-badge" title={`Release ${guide.number}`}>{guide.number}</span>}
    </motion.div>
    <strong title={title}>{title}</strong>
    <span className="destination-state">{guide.status === 'locked' ? 'Locked' : guide.status === 'completed' ? 'Completed' : guide.suggested && release ? 'Suggested next' : 'Available'}</span>
    <Handle type="source" position={Position.Right} />
  </div>
})

function RegionNode({ data }: NodeProps<Node<{ label: string }, 'region'>>) {
  return <div className="universe-group"><span>{data.label}</span></div>
}

type Journey = { id: string; from: string; serial: number }
type OrbitEdge = Edge<{ incident: boolean; primary: boolean; preview: boolean; label: string; journey: Journey | null }, 'orbit'>
const UniverseEdge = memo(function UniverseEdge({ id, source, sourceX, sourceY, targetX, targetY, data }: EdgeProps<OrbitEdge>) {
  const reduced = useReducedMotion()
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  const journey = data?.journey
  const travelPath = journey?.from === source ? path : `M ${targetX},${targetY} L ${sourceX},${sourceY}`
  return <g style={{ '--edge-color': data?.primary ? 'var(--teal)' : 'var(--peach)' } as CSSProperties} className={`orbit-edge ${data?.incident ? 'incident' : ''} ${data?.preview ? 'route-preview' : ''}`}>
    <PointerEdge id={id} sourceX={sourceX} sourceY={sourceY} targetX={targetX} targetY={targetY} bend={!journey}
      label={data?.preview ? data.label : undefined}
      style={{ stroke: 'var(--edge-color)', strokeWidth: data?.preview ? 3 : data?.incident ? 1.5 : 1,
      strokeDasharray: data?.primary || data?.preview ? undefined : '4 9', opacity: data?.preview ? 1 : data?.incident ? .65 : .25 }} />
    {journey && !reduced && <g key={journey.serial} className="journey-trail" aria-hidden="true">
      <motion.path d={travelPath} fill="none" stroke="var(--teal)" strokeWidth={4} initial={{ pathLength: 0, opacity: 1 }}
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
  release: boolean; onFocus: (media: Media) => void
  onEnter: (media: Media) => void; details: (enter: () => void) => ReactNode
}

export default function UniverseCanvas({ universe, model, guide, focusedId, active, release, onFocus, onEnter, details }: Props) {
  const reduced = useReducedMotion()
  const [positions, setPositions] = useState<Positions>({})
  const [layoutState, setLayoutState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [size, setSize] = useState({ width: 1000, height: 650 })
  const [overview, setOverview] = useState(false)
  const [entering, setEntering] = useState(false)
  const [detailsMinimized, setDetailsMinimized] = useState(false)
  const detailsId = useId()
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [hovered, setHovered] = useState<{ nodeId?: string; edgeId?: string } | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const pointer = useCanvasParallax(container, active)
  const anchors = useRef<Positions>({})
  const previousFocus = useRef(focusedId)
  const travelSerial = useRef(0)
  const mediaById = useMemo(() => new Map(model.media.map(item => [item.id, item])), [model])
  const neighbors = useMemo(() => connectedNeighbors(model, focusedId), [model, focusedId])
  const nearby = useMemo(() => new Set([focusedId, ...neighbors]), [focusedId, neighbors])
  const previewLink = model.links.find(link => link.id === hovered?.edgeId
    || (hovered?.nodeId !== focusedId && ((link.source === focusedId && link.target === hovered?.nodeId)
      || (link.target === focusedId && link.source === hovered?.nodeId))))
  const previewId = hovered?.nodeId ?? (previewLink ? connectionDestination(previewLink, focusedId) : null)
  const previewNode = useCallback((id: string | null) => setHovered(id ? { nodeId: id } : null), [])
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

  useEffect(() => {
    if (!entering || !flow || !positions[focusedId]) return
    const point = positions[focusedId]
    void flow.setCenter(point.x + MEDIA_WIDTH / 2, point.y + 50, { zoom: reduced ? 1 : 3.4, duration: reduced ? 0 : 850, ease: cameraEase })
  }, [entering, flow, focusedId, positions, reduced])

  const focus = useCallback((id: string) => {
    const media = mediaById.get(id)
    if (!media) return
    setHovered(null)
    setOverview(false)
    onFocus(media)
  }, [mediaById, onFocus])

  const previous = model.links.find(link => link.target === focusedId && link.primary)?.source
    ?? directionalNeighbor(focusedId, neighbors, positions, directions.ArrowLeft)
  const next = model.links.find(link => link.source === focusedId && link.primary)?.target
    ?? directionalNeighbor(focusedId, neighbors, positions, directions.ArrowRight)
    ?? neighbors.find(id => id !== previous)

  useEffect(() => {
    if (!active || entering) return
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
  }, [active, entering, focusedId, neighbors, positions, previous, next, focus])

  const nodes = useMemo<Node[]>(() => [
    ...groupBounds(model, positions).map(b => ({ id: b.id, type: 'region', position: { x: b.x, y: b.y },
      data: { label: b.label }, style: { width: b.width, height: b.height },
      selectable: false, focusable: false, zIndex: -1 })),
    ...model.media.filter(m => positions[m.id]).map(media => ({
      id: media.id, type: 'destination', focusable: false, position: positions[media.id], width: MEDIA_WIDTH, height: MEDIA_HEIGHT,
      zIndex: focusedId === media.id ? 3 : 1,
      data: { media, guide: guide[media.id], release, focused: focusedId === media.id, nearby: nearby.has(media.id), overview,
        preview: previewId === media.id || previewLink?.source === media.id || previewLink?.target === media.id, onFocus: focus, onPreview: previewNode },
      ariaLabel: `${worldTitle(media, guide[media.id])}, ${guide[media.id].status}. Select to explore this world.`,
    })),
  ], [model, positions, guide, release, focusedId, nearby, overview, focus, previewId, previewLink, previewNode])

  const edges = useMemo<OrbitEdge[]>(() => model.links.filter(link => link.source !== link.target).map(link => ({
    id: link.id, source: link.source, target: link.target, type: 'orbit', focusable: false,
    ariaLabel: `${relationLabel(link.kind)} connection. Travel to the connected world.`,
    data: { incident: overview || illuminated.has(link.id) || journey?.id === link.id, primary: link.primary,
      preview: previewLink?.id === link.id,
      label: overview ? '' : link.kind === 'SEQUEL' && link.relations.some(r => r.type.toUpperCase() === 'PREQUEL') ? 'prequel / sequel' : relationLabel(link.kind),
      journey: journey?.id === link.id ? journey : null },
  })), [model, overview, illuminated, journey, previewLink])

  return <div className={`universe-composition ${overview ? 'is-overview' : ''} ${entering ? 'is-entering' : ''}`}>
    <div ref={container} inert={entering} className={`universe-canvas celestial ${overview ? 'overview-mode' : 'focus-mode'}`} aria-label="Anime universe canvas" aria-busy={layoutState === 'loading'}>
    <CanvasPointerContext.Provider value={pointer}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlow} proOptions={{ hideAttribution: true }}
      minZoom={.01} maxZoom={3.4} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false}
      panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
      preventScrolling selectionOnDrag={false} autoPanOnNodeFocus={false} autoPanOnNodeDrag={false}
      onNodeMouseEnter={(_, node) => previewNode(node.id)} onNodeMouseLeave={() => previewNode(null)}
      onEdgeMouseEnter={(_, edge) => setHovered({ edgeId: edge.id })} onEdgeMouseLeave={() => setHovered(null)}
      onEdgeClick={(_, edge) => focus(connectionDestination(edge, focusedId))}
      onNodeClick={(_, node) => focus(node.id)} colorMode="dark">
      <Panel position="top-left" className="canvas-toolbar">
        <button onClick={() => focus(universe.root_id)}>⌂ Home world</button>
      </Panel>

      <Panel position="bottom-center" className="journey-navigation">
        <div className="journey-controls">
          <button disabled={!previous} onClick={() => previous && focus(previous)} title={previous ? worldTitle(mediaById.get(previous)!, guide[previous]) : 'No previous connection'}>← Previous</button>
          <span>{overview ? 'The whole constellation' : 'Travel the connections'}<small>{overview ? `${model.media.length} connected worlds` : 'Arrow keys or select a nearby world'}</small></span>
          <button disabled={!next} onClick={() => next && focus(next)} title={next ? worldTitle(mediaById.get(next)!, guide[next]) : 'No next connection'}>Next →</button>
        </div>
      </Panel>
    </ReactFlow></CanvasPointerContext.Provider>
    </div>
      <div className="overview-control" inert={entering}>
        <button aria-label={overview ? 'Return to Focus Mode' : 'Show constellation overview'} aria-pressed={overview} onClick={() => setOverview(value => !value)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={overview ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
          </svg>{overview ? 'Back to focus' : 'Overview'}
        </button>
      </div>
    {!overview && layoutState !== 'loading' && <motion.div inert={entering} key={focusedId} className={`universe-inspector ${detailsMinimized ? 'details-minimized' : ''}`}
      initial={{ opacity: 0, x: reduced ? 0 : 18 }} animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduced ? 0 : .45, delay: reduced ? 0 : .35 }}>
      <button className="inspector-toggle" aria-label={detailsMinimized ? 'Show details' : 'Minimize details'}
        title={detailsMinimized ? 'Show details' : 'Minimize details'} aria-expanded={!detailsMinimized} aria-controls={detailsId}
        onClick={() => setDetailsMinimized(value => !value)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d={detailsMinimized ? 'M5 12h14M12 5v14' : 'M5 12h14'} />
        </svg>{detailsMinimized && 'Show details'}
      </button>
      <div id={detailsId} hidden={detailsMinimized}>{details(() => setEntering(true))}</div>
    </motion.div>}
    {entering && <motion.div className="world-entry" role="status" initial={{ opacity: 0 }} animate={{ opacity: [0, .15, 1] }}
      transition={{ duration: reduced ? 0 : .9, times: [0, .55, 1] }}
      onAnimationComplete={() => { setEntering(false); const item = mediaById.get(focusedId); if (item) onEnter(item) }}>
      <span>Entering your world</span>
    </motion.div>}
    <div className="journey-announcement" role="status" aria-live="polite">{mediaById.has(focusedId) ? worldTitle(mediaById.get(focusedId)!, guide[focusedId]) : ''}{overview ? ', Overview Mode' : ', Focus Mode'}</div>
    {layoutState === 'loading' && <div role="status" className="canvas-status">Mapping the universe…</div>}
    {layoutState === 'fallback' && <div role="status" className="canvas-status">Automatic layout unavailable. Showing grouped worlds.</div>}
    {!model.media.length && <div className="canvas-status">No connected works discovered.</div>}
  </div>
}
