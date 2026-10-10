import type { Media, Universe, UserMediaState } from '../lib/types'
import type { UniverseModel } from '../lib/universeModel'
import { relationLabel } from '../lib/universeModel'
import { releaseLabel, worldTitle } from '../lib/universeProgression'
import type { ReleaseGuide } from '../lib/universeProgression'

interface Props {
  media: Media | undefined; universe: Universe; model: UniverseModel; guide: Record<string, ReleaseGuide>; release: boolean
  state?: UserMediaState; busy: boolean; onEnter: (media: Media) => void; onUnlock: (media: Media) => void; onComplete: (media: Media) => void
  onFocus: (media: Media) => void; message: string
}
export default function UniverseDetails({ media, universe, model, guide, release, state, busy, onEnter, onUnlock, onComplete, onFocus, message }: Props) {
  const currentGuide = media && guide[media.id]
  if (!media || !currentGuide) return <aside className="details panel"><p>Select a destination to explore.</p></aside>
  const locked = currentGuide.status === 'locked'
  const group = model.groups.find(group => group.mediaIds.includes(media.id))
  const previous = model.media.find(item => item.id === currentGuide.previousId)
  const root = model.media.find(item => item.id === universe.root_id)
  const connections = model.links.filter(link => link.source === media.id || link.target === media.id)
  const kinds = [...new Set(connections.map(link => relationLabel(link.kind)))].slice(0, 3)
  const unit = state?.progress?.unit ?? 0
  const progressText = media.has_prologue ? unit === 0 ? 'Not started' : unit === 1 ? 'Prologue watched' : `Through episode ${unit - 1}`
    : `${unit} ${media.progress_unit}${unit === 1 ? '' : 's'} watched`
  // Describe the map using metadata; provider plot synopses have no spoiler-safe reveal boundary.
  const summary = connections.length ? `A connected ${media.format === 'MOVIE' ? 'film' : 'world'} in ${root ? worldTitle(root, guide[root.id]) : 'this'}’s universe. Explore its ${kinds.join(', ')} connections.`
    : 'Your starting point in this universe. Enter to discover characters at your own pace.'
  return <aside className="details panel universe-details" aria-label="Selected anime">
    <div className="world-panel-heading"><span className={`watch-state ${currentGuide.status}`}>{locked ? 'Locked' : currentGuide.status === 'completed' ? 'Completed' : 'Available'}</span></div>
    <h2>{worldTitle(media, currentGuide)}</h2>
    <p className="world-focus-label">{group?.label}</p>
    {locked ? <><p>Continue from the previous entry, or choose your own starting point.</p>
      {previous && <button className="relation-jump" onClick={() => onFocus(previous)}>Previous: {worldTitle(previous, guide[previous.id])}</button>}
      <button className="primary" disabled={busy} onClick={() => onUnlock(media)}>Unlock anyway</button></> : <>
      <p className="world-summary">{summary}</p>
      <div className="world-metadata"><span>{media.format || media.type}</span><span>{media.total_units_known ? `${media.total_units} ${media.progress_unit}s${media.has_prologue ? ' (includes prologue)' : ''}` : 'Episode count uncertain'}</span><span>{releaseLabel(media)}</span></div>
      <div className="world-progress"><div><span>Your progress</span><strong>{currentGuide.status === 'completed' ? 'Completed' : progressText}</strong></div>
        {media.total_units_known && <progress aria-label={`${media.title} viewing progress`} max={media.total_units} value={Math.min(unit, media.total_units)} />}
      </div>
      {release && <p>Release {currentGuide.number}{currentGuide.approximateDate ? ' · approximate date' : ''}</p>}
      <button className="primary enter-world" disabled={busy} onClick={() => onEnter(media)}>Enter World <span aria-hidden="true">↗</span></button>
      {currentGuide.status !== 'completed' && <button className="complete-world" disabled={busy} onClick={() => onComplete(media)}>I finished this anime</button>}
    </>}
    {message && <p role="status">{message}</p>}
    {(universe.truncated || universe.cache?.incomplete) && <p className="guidance-note">This is a bounded, incomplete map. More connections may exist.</p>}
    {universe.cache?.stale && <p className="guidance-note">Cached metadata may be out of date.</p>}
  </aside>
}
