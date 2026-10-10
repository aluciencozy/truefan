import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Routes, useLocation, useNavigationType } from 'react-router-dom'
import type { Location, NavigationType } from 'react-router-dom'
import { PageTransitionContext, pageDestination } from '../lib/pageTransition'
import './PageTransition.css'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(reducedMotionQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
function reducedMotionSnapshot(): boolean { return window.matchMedia(reducedMotionQuery).matches }

type Phase = 'idle' | 'departing' | 'orbiting' | 'arriving'
interface Journey {
  id: number
  location: Location
  type: NavigationType
  mounted: boolean
  ready: boolean
  minimumReached: boolean
  arriving: boolean
}

export default function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const reduced = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true)
  const [displayed, setDisplayed] = useState(location)
  const [phase, setPhase] = useState<Phase>('idle')
  const [navigationId, setNavigationId] = useState(0)
  const sequence = useRef(0)
  const requested = useRef(location)
  const journey = useRef<Journey | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const content = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<{ key: string; x: number; y: number; restore: boolean; waiting: boolean } | null>(null)
  const pendingFocus = useRef(false)

  const cancelTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
  }, [])
  const later = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.current.delete(timer); callback() }, delay)
    timers.current.add(timer)
  }, [])
  const finish = useCallback((current: Journey) => {
    if (journey.current !== current) return
    cancelTimers()
    journey.current = null
    pendingFocus.current = true
    setPhase('idle')
  }, [cancelTimers])
  const arrive = useCallback((current: Journey) => {
    if (journey.current !== current || !current.mounted || current.arriving) return
    current.arriving = true
    setPhase('arriving')
    later(() => finish(current), 220)
  }, [finish, later])
  const restoreScroll = useCallback(() => {
    const pending = pendingScroll.current
    if (!pending || pending.waiting) return
    window.scrollTo({ left: pending.x, top: pending.y, behavior: 'instant' })
    pendingScroll.current = null
  }, [])
  const reportReady = useCallback((ready: boolean) => {
    if (navigationId !== sequence.current) return
    const scroll = pendingScroll.current
    if (scroll?.key === displayed.key) {
      // Restoring before a feed renders can clamp a saved position to the top.
      scroll.waiting = scroll.restore && !ready
      if (ready) restoreScroll()
    }
    const current = journey.current
    if (!current?.mounted || current.id !== navigationId || current.location.key !== displayed.key) return
    current.ready = ready
    if (ready && current.minimumReached) arrive(current)
  }, [arrive, displayed.key, navigationId, restoreScroll])

  useLayoutEffect(() => {
    const previous = requested.current
    requested.current = location
    if (previous.key === location.key && !(reduced && journey.current)) return

    const current = journey.current
    // Dialog/search query edits update the route without starting another journey.
    if (pageDestination(previous) === pageDestination(location) && !(reduced && current)) {
      if (current) {
        current.location = location
        if (current.mounted) setDisplayed(location)
      } else setDisplayed(location)
      return
    }

    positions.current.set(displayed.key, { x: window.scrollX, y: window.scrollY })
    cancelTimers()
    const next: Journey = { id: ++sequence.current, location, type: navigationType, mounted: false, ready: true, minimumReached: false, arriving: false }
    journey.current = next
    setNavigationId(next.id)
    function mount() {
      if (journey.current !== next) return
      next.mounted = true
      const position = next.type === 'POP' ? positions.current.get(next.location.key) ?? { x: 0, y: 0 } : { x: 0, y: 0 }
      pendingScroll.current = { key: next.location.key, ...position, restore: next.type === 'POP', waiting: false }
      setDisplayed(next.location)
      setPhase(reduced ? 'idle' : 'orbiting')
    }
    if (reduced) {
      mount()
      finish(next)
      return
    }
    // When already covered, skip departure and replace the pending destination.
    if (current?.mounted && !current.arriving) mount()
    else { setPhase('departing'); later(mount, 140) }
    later(() => { next.minimumReached = true; if (next.ready) arrive(next) }, 430)
    later(() => arrive(next), 980)
    // displayed changes when mounting; navigation is driven only by the requested location.
  }, [location, navigationType, reduced, arrive, cancelTimers, finish, later])

  useLayoutEffect(() => {
    restoreScroll()
    if (phase === 'idle' && pendingFocus.current) {
      pendingFocus.current = false
      const main = content.current?.querySelector<HTMLElement>('main')
      main?.setAttribute('tabindex', '-1')
      main?.focus({ preventScroll: true })
    }
  }, [displayed, phase, restoreScroll])

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { cancelTimers(); window.history.scrollRestoration = previous }
  }, [cancelTimers])

  const busy = phase !== 'idle'
  return <div className={`page-transition page-transition-${phase}`}>
    <div ref={content} className="page-transition-content" inert={busy} aria-hidden={busy ? true : undefined}>
      <PageTransitionContext.Provider value={reportReady}>
        <Routes location={displayed}>{children}</Routes>
      </PageTransitionContext.Provider>
    </div>
    {busy && <div className="page-transition-sky">
      <div className="page-transition-constellation" aria-hidden="true">
        <svg viewBox="0 0 400 280" fill="none">
          <path d="M30 190 88 150 135 196M265 84 310 130 367 92" />
          {[ [30, 190], [88, 150], [135, 196], [265, 84], [310, 130], [367, 92] ].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />)}
          <ellipse cx="200" cy="140" rx="94" ry="58" />
        </svg>
        <div className="page-transition-orbit"><div className="page-transition-orbit-track"><span /></div></div>
        <span className="page-transition-star">✦</span>
      </div>
      <span className="page-transition-status" role="status" aria-live="polite">Finding your next constellation…</span>
    </div>}
  </div>
}
