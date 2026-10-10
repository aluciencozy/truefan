import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Entity, GraphResponse, Media } from '../lib/types'

export default function EntityDetails({ entity, media, graph, onClose, onSelect }: {
  entity: Entity; media: Media; graph: GraphResponse; onClose: () => void; onSelect: (id: string) => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => { close.current?.focus({ preventScroll: true }) }, [])
  const related = graph.relationships.filter(edge => edge.source === entity.id || edge.target === entity.id)
  return <motion.aside className="details" aria-label="Selected entity details"
    initial={{ x: reduced ? 0 : '100%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: reduced ? 0 : '100%', opacity: 0 }}
    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 230, damping: 30 }} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <header><span>In focus / {entity.type}</span><button ref={close} onClick={onClose} aria-label="Close character details">×</button></header>
    <div className={`detail-portrait ${entity.type}`} aria-hidden="true"><span>{entity.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span></div>
    <h2>{entity.name}</h2><p className="detail-story">{media.title}</p>
    <p>{entity.description}</p>
    <section className="detail-connections"><h3>Known connections <span>{related.length}</span></h3>
      {related.length ? related.map(edge => {
        const other = graph.entities.find(item => item.id === (edge.source === entity.id ? edge.target : edge.source))
        return other ? <button key={edge.id} onClick={() => onSelect(other.id)}><span>{other.name}<small>{edge.label || edge.type}</small></span><span aria-hidden="true">↗</span></button> : null
      }) : <p>No connections revealed at this point.</p>}
    </section>
    <dl className="detail-provenance"><dt>{entity.provenance.verified ? 'First revealed' : 'Description supported at'}</dt><dd>{media.has_prologue ? entity.provenance.episode_number === 0 ? 'Prologue' : `Episode ${entity.provenance.episode_number}` : `${media.progress_unit} ${entity.revealed_at.unit}`}</dd>
      <dt>Source</dt><dd>{entity.provenance.source.startsWith('https://') ? <a href={entity.provenance.source} target="_blank" rel="noreferrer">{entity.provenance.source_title || 'Episode source'}</a> : entity.provenance.source}</dd>
      {!entity.provenance.verified && <><dt>Experimental AI</dt><dd>Unverified source-derived information. Spoiler safety is approximate.</dd></>}</dl>
  </motion.aside>
}
