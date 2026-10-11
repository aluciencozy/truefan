import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { api } from '../lib/api'
import { demoStartUrl, describePick, startUrl, universeUrl } from '../lib/explore'
import type { SurprisePick as Pick, TrendingCover } from '../lib/types'
import './SurprisePick.css'

export type SurpriseService = { surprise: (exclude?: string, signal?: AbortSignal) => Promise<Pick> }
const SHUFFLE_MS = 1000
const message = (error: unknown) => error instanceof Error ? error.message : 'We couldn’t find a story just now.'
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function Shuffle({ covers }: { covers: TrendingCover[] }) {
  const slots = Array.from({ length: 6 }, (_, index) => covers[index])
  return <div className="surprise-shuffle" aria-hidden="true">
    {slots.map((cover, index) => <span key={index} className="surprise-orbiter" style={{ '--i': index } as React.CSSProperties}>
      {cover ? <img src={cover.cover_url} alt="" width="44" height="44" onError={event => { event.currentTarget.style.visibility = 'hidden' }} /> : <b>✦</b>}
    </span>)}
    <span className="surprise-core">✦</span>
  </div>
}

type Phase = { kind: 'shuffling' } | { kind: 'error'; text: string } | { kind: 'result'; pick: Pick }

export function SurpriseDialog({ onClose, covers = [], service = api }: { onClose: () => void; covers?: TrendingCover[]; service?: SurpriseService }) {
  const ref = useRef<HTMLDialogElement>(null)
  const primary = useRef<HTMLAnchorElement>(null)
  const controller = useRef<AbortController | null>(null)
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>({ kind: 'shuffling' })
  const current = phase.kind === 'result' ? phase.pick.media.id : undefined

  const shuffle = useCallback(async (exclude?: string) => {
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setPhase({ kind: 'shuffling' })
    try {
      // The shuffle is decorative: the pick is already decided, we just let it settle for about a second.
      const [pick] = await Promise.all([service.surprise(exclude, request.signal), reduced ? undefined : pause(SHUFFLE_MS)])
      if (!request.signal.aborted) setPhase({ kind: 'result', pick })
    } catch (error) { if (!request.signal.aborted) setPhase({ kind: 'error', text: message(error) }) }
  }, [service, reduced])

  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    void shuffle()
    return () => { controller.current?.abort(); dialog.close(); previous?.focus?.() }
  }, [shuffle])
  useEffect(() => { if (phase.kind === 'result') primary.current?.focus() }, [phase])

  const described = phase.kind === 'result' ? describePick(phase.pick) : null
  return <dialog ref={ref} className="surprise-dialog" aria-labelledby="surprise-title" onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="surprise-inner">
      <button className="surprise-close" aria-label="Close" onClick={onClose}>×</button>
      <p className="surprise-kicker">✦ Surprise me</p>
      {phase.kind === 'shuffling' && <div className="surprise-status" role="status">
        {!reduced && <Shuffle covers={covers} />}
        <h2 id="surprise-title">Finding a story for you…</h2>
        <p>Picking something that’s ready to explore.</p>
      </div>}
      {phase.kind === 'error' && <div className="surprise-status">
        <h2 id="surprise-title">We lost the signal</h2>
        <p role="alert">{phase.text}</p>
        <div className="surprise-actions">
          <button className="surprise-button primary" onClick={() => void shuffle()}>Try again</button>
          <Link className="surprise-button" to={demoStartUrl} onClick={onClose}>Try the Lantern Harbor demo</Link>
        </div>
      </div>}
      {phase.kind === 'result' && described && <motion.div className="surprise-result" initial={reduced ? false : { opacity: 0, y: 12, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
        <div className="surprise-card">
          <span className="surprise-cover">{phase.pick.media.cover_url
            ? <img src={phase.pick.media.cover_url} alt={`${phase.pick.media.title} cover`} width="120" height="170" onError={event => { event.currentTarget.hidden = true }} /> : null}<i aria-hidden="true">✦</i></span>
          <div className="surprise-copy">
            <h2 id="surprise-title">{phase.pick.media.title}</h2>
            <p className="surprise-meta">{described.meta}</p>
            <p className="surprise-hook">{phase.pick.hook}</p>
            <ul className="surprise-tags" aria-label="Genres">{phase.pick.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
            <p className="surprise-characters">✦ {described.characters}</p>
          </div>
        </div>
        <div className="surprise-actions">
          <Link ref={primary} className="surprise-button primary" to={startUrl(phase.pick)} onClick={onClose}>{described.start}</Link>
          <Link className="surprise-button" to={universeUrl(phase.pick)} onClick={onClose}>Show me its universe</Link>
          <button className="surprise-button ghost" onClick={() => void shuffle(current)}>Pick another</button>
        </div>
      </motion.div>}
    </div>
  </dialog>
}

/** The "Surprise me" entry point: a button plus its pick card. Used on the home page and in Explore. */
export default function SurpriseLauncher({ covers, className = '', service }: { covers?: TrendingCover[]; className?: string; service?: SurpriseService }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={`surprise-launch ${className}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>Not sure where to start? Surprise me <span aria-hidden="true">✦</span></button>
    {open && <SurpriseDialog covers={covers} service={service} onClose={() => setOpen(false)} />}
  </>
}
