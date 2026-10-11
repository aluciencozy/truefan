import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { api } from '../lib/api'
import { completionsLabel, constellationCaption, hashString, neighbourInDirection, seededRandom, trendingLabel, skyLayout, starSubtitle } from '../lib/trendingSky'
import type { SkyConstellation } from '../lib/trendingSky'
import type { TrendingConstellation, TrendingConstellations, TrendingStar } from '../lib/types'
import SurpriseLauncher from './SurprisePick'
import './TrendingSky.css'

export type TrendingService = { trendingConstellations: (limit?: number, signal?: AbortSignal) => Promise<TrendingConstellations> }
type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; data: TrendingConstellations }
const DEFAULT_WIDTH = 1100, DEFAULT_HEIGHT = 560
const exploreLink = (mediaId: string) => `/explore?media=${encodeURIComponent(mediaId)}`

// Faint dots shown while loading; deterministic so the placeholder never jumps.
const placeholder = (() => { const random = seededRandom(hashString('trending-placeholder')); return Array.from({ length: 28 }, () => ({ x: random() * 100, y: random() * 100, r: 1 + random() * 2, d: random() * 2 })) })()

function Hint({ children }: { children: ReactNode }) { return <p className="trending-note">{children}</p> }

export default function TrendingSky({ fallback, service = api, hideTitle = false }: { fallback: ReactNode; service?: TrendingService; hideTitle?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [hover, setHover] = useState<{ constellation: string; star: string | null } | null>(null)
  const [roving, setRoving] = useState<Record<string, string>>({})
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const frame = useRef<HTMLDivElement>(null)
  const stars = useRef(new Map<string, SVGGElement>())

  useEffect(() => {
    const controller = new AbortController()
    service.trendingConstellations(5, controller.signal).then(data => { if (!controller.signal.aborted) setState({ kind: 'ready', data }) })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: 'failed' }) })
    return () => controller.abort()
  }, [service])
  useEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (box && box.width > 0 && box.height > 0) setSize(previous => previous.width === Math.round(box.width) && previous.height === Math.round(box.height) ? previous : { width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [state.kind])

  const data = state.kind === 'ready' ? state.data : null
  const trendingMode = data?.source === 'anilist_trending'
  const layout = useMemo(() => data ? skyLayout(data.constellations, size.width, size.height) : null, [data, size])
  if (state.kind === 'failed' || (data && !data.constellations.length)) return <>{fallback}</>

  const byId = new Map(data?.constellations.map(constellation => [constellation.franchise_id, constellation]) ?? [])
  const focusStar = (constellationId: string, mediaId: string) => { setRoving(previous => ({ ...previous, [constellationId]: mediaId })); stars.current.get(`${constellationId}:${mediaId}`)?.focus() }
  function onKey(event: KeyboardEvent, sky: SkyConstellation, star: TrendingStar) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(exploreLink(star.media_id)); return }
    const next = neighbourInDirection(sky.stars, star.media_id, event.key)
    if (next) { event.preventDefault(); focusStar(sky.id, next) }
  }
  const active = hover?.constellation ?? null
  const card = hover?.star && layout ? (() => {
    const sky = layout.constellations.find(item => item.id === hover.constellation)!
    const point = sky.stars.find(item => item.id === hover.star)!
    const star = byId.get(hover.constellation)!.stars.find(item => item.media_id === hover.star)!
    const cardWidth = Math.min(236, layout.width - 16)
    return { star, left: Math.min(layout.width - cardWidth - 8, Math.max(8, point.x - cardWidth / 2)), top: point.y > layout.height - 150 ? point.y - point.r - 118 : point.y + point.r + 14, width: cardWidth }
  })() : null

  return <section className="trending-sky" aria-labelledby={hideTitle ? undefined : 'trending-title'}>
    <header className={`trending-heading${hideTitle ? ' is-compact' : ''}`}>
      {hideTitle ? null : <div>
        <h2 id="trending-title">Trending constellations</h2>
        <p>What anime fans are watching right now, and the stories connected to them.</p>
        {data?.source === 'truefan_completions' && <Hint>Based on TrueFan completions this month</Hint>}
      </div>}
      <SurpriseLauncher />
    </header>
    <div className="trending-scroll" ref={frame}>
      {!layout ? <div className="trending-canvas" style={{ height: 420 }} role="status" aria-label="Loading trending constellations">
        <svg className="trending-svg" width="100%" height="420" aria-hidden="true">{placeholder.map((dot, index) => <circle key={index} className="sky-placeholder" cx={`${dot.x}%`} cy={`${dot.y}%`} r={dot.r} style={{ animationDelay: `${dot.d}s` }} />)}</svg>
      </div> : <div className="trending-canvas" style={{ height: layout.height }} onPointerLeave={() => setHover(null)}>
        <svg className="trending-svg" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Trending constellations">
          <defs><radialGradient id="sky-glow"><stop offset="0" stopColor="#f2edff" stopOpacity=".95" /><stop offset=".35" stopColor="#cba6f7" stopOpacity=".38" /><stop offset="1" stopColor="#cba6f7" stopOpacity="0" /></radialGradient></defs>
          {layout.constellations.map(sky => {
            const source = byId.get(sky.id) as TrendingConstellation
            const tabbable = roving[sky.id] ?? source.entry_media_id
            return <g key={sky.id} className={`sky-constellation${active === sky.id ? ' is-active' : ''}${active && active !== sky.id ? ' is-dim' : ''}`}
              onPointerEnter={() => setHover({ constellation: sky.id, star: null })} onFocus={() => setHover(previous => previous?.constellation === sky.id ? previous : { constellation: sky.id, star: null })}>
              {sky.links.map((link, index) => link.inferred
                ? <motion.path key={`${link.source}-${link.target}`} className="sky-link inferred" d={`M${link.x1} ${link.y1}L${link.x2} ${link.y2}`} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: .3 }} transition={{ duration: .8, delay: .4 + index * .1 }} />
                : <motion.path key={`${link.source}-${link.target}`} className="sky-link" d={`M${link.x1} ${link.y1}L${link.x2} ${link.y2}`} initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: .65 }} transition={{ duration: .9, delay: .2 + index * .12 }} />)}
              {sky.stars.map(point => {
                const star = source.stars.find(item => item.media_id === point.id)!
                const text = [star.title, starSubtitle(star), star.trending && star.trending_rank ? trendingLabel(star.trending_rank) : '',
                  star.completions > 0 ? completionsLabel(star.completions, trendingMode) : ''].filter(Boolean).join(', ')
                return <g key={point.id} ref={element => { const key = `${sky.id}:${point.id}`; if (element) stars.current.set(key, element); else stars.current.delete(key) }}
                  className={`sky-star${star.trending ? ' is-seed' : ''}${hover?.star === point.id ? ' is-hovered' : ''}`} role="button" tabIndex={tabbable === point.id ? 0 : -1} aria-label={text} aria-describedby={hover?.star === point.id ? 'sky-card' : undefined}
                  onClick={() => navigate(exploreLink(point.id))} onKeyDown={event => onKey(event, sky, star)}
                  onPointerEnter={() => setHover({ constellation: sky.id, star: point.id })} onFocus={() => { setRoving(previous => ({ ...previous, [sky.id]: point.id })); setHover({ constellation: sky.id, star: point.id }) }}
                  onBlur={() => setHover(previous => previous?.star === point.id ? { constellation: sky.id, star: null } : previous)}>
                  <circle className="sky-hit" cx={point.x} cy={point.y} r={point.r + 12} />
                  <circle className="sky-glow" cx={point.x} cy={point.y} r={point.glow} fill="url(#sky-glow)" opacity={point.opacity} />
                  <circle className="sky-core" cx={point.x} cy={point.y} r={point.r} style={{ opacity: point.opacity, animationDelay: `${point.delay}s` }} />
 {star.trending && <circle className="sky-seed-ring" cx={point.x} cy={point.y} r={point.r + 3.5} />}
                  <circle className="sky-ring" cx={point.x} cy={point.y} r={point.r + 5} />
                </g>
              })}
            </g>
          })}
        </svg>
        {layout.constellations.map(sky => {
          const source = byId.get(sky.id) as TrendingConstellation
          return <div key={sky.id} className={`sky-label${active === sky.id ? ' is-active' : ''}${active && active !== sky.id ? ' is-dim' : ''}`} style={{ left: sky.label.x, top: sky.label.y, width: sky.label.w }}
            onPointerEnter={() => setHover({ constellation: sky.id, star: null })}>
            <Link to={exploreLink(source.entry_media_id)}>{source.title}</Link>
            <small>{constellationCaption(source.trending_rank, source.score, trendingMode)}</small>
          </div>
        })}
        {card && <div id="sky-card" className="sky-card" role="tooltip" style={{ left: card.left, top: card.top, width: card.width }}>
          <span className="sky-card-cover">{card.star.cover_url ? <img src={card.star.cover_url} alt="" width="48" height="68" loading="lazy" onError={event => { event.currentTarget.hidden = true }} /> : null}<i aria-hidden="true">✦</i></span>
          <span className="sky-card-copy"><b>{card.star.title}</b>{starSubtitle(card.star) && <small>{starSubtitle(card.star)}</small>}{card.star.trending && card.star.trending_rank && <strong>{trendingLabel(card.star.trending_rank)}</strong>}{card.star.completions > 0 && <em>{completionsLabel(card.star.completions, trendingMode)}</em>}</span>
        </div>}
      </div>}
    </div>
  </section>
}
