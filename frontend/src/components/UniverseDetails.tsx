import type { Media, Universe } from '../lib/types'
import type { UniverseModel } from '../lib/universeModel'
import { relationLabel } from '../lib/universeModel'
import { releaseLabel } from '../lib/universeProgression'
import type { ReleaseGuide } from '../lib/universeProgression'

interface Props {
  media: Media | undefined; universe: Universe; model: UniverseModel; guide: ReleaseGuide | undefined; release: boolean
  busy: boolean; onEnter: (media: Media) => void; onUnlock: (media: Media) => void; onComplete: (media: Media) => void
  onFocus: (media: Media) => void; message: string
}
export default function UniverseDetails({ media, universe, model, guide, release, busy, onEnter, onUnlock, onComplete, onFocus, message }: Props) {
  if (!media || !guide) return <aside className="details panel"><h2>In focus</h2><p>Select a destination to explore.</p></aside>
  const locked = guide.status === 'locked'
  const relations = model.links.flatMap(link => link.relations).filter(r => r.source === media.id || r.target === media.id)
  const previous = model.media.find(item => item.id === guide.previousId)
  return <aside className="details panel universe-details" aria-label="Selected anime">
    <div className="focus-art">{media.cover_url ? <img src={media.cover_url} alt={`Cover of ${media.title}`} /> : <span aria-hidden="true">✦</span>}</div>
    <h2>{media.title}</h2><span className={`watch-state ${guide.status}`}>{guide.status === 'locked' ? 'Locked' : guide.status === 'completed' ? 'Completed' : 'Available'}</span>
    {locked ? <><p>Complete the previous entry in this inferred branch, or choose your own starting point.</p>
      {previous && <button className="relation-jump" onClick={() => onFocus(previous)}>Previous: {previous.title}</button>}
      <button className="primary" disabled={busy} onClick={() => onUnlock(media)}>Unlock anyway</button></> : <>
      <p>{media.format || media.type}{media.total_units_known ? ` / ${media.total_units} ${media.progress_unit}s` : ' / episode count uncertain'}</p>
      <p>{releaseLabel(media)}</p>
      {release && <p>Branch {guide.branchNumber}, release {guide.number}{guide.approximateDate ? ' · approximate date' : ''}</p>}
      <button className="primary" disabled={busy} onClick={() => onEnter(media)}>Enter anime</button>
      {guide.status !== 'completed' && <button disabled={busy} onClick={() => onComplete(media)}>I finished this anime</button>}
    </>}
    {message && <p role="status">{message}</p>}
    <details className="relation-list" open><summary>Connections ({relations.length})</summary>
      {relations.length ? relations.map(relation => {
        const other = model.media.find(m => m.id === (relation.source === media.id ? relation.target : relation.source))
        if (!other) return null
        return <div key={JSON.stringify(relation)}><span>{relation.source === media.id ? 'Has ' : 'Related from: '}{relationLabel(relation.type)}</span>
          <button onClick={() => onFocus(other)}>{other.title}</button></div>
      }) : <p>No connections discovered yet.</p>}
    </details>
    <p className="guidance-note">Branch release guidance is approximate, not canonical prerequisites or guaranteed spoiler-free viewing.</p>
    {(universe.truncated || universe.cache?.incomplete) && <p className="guidance-note">This is a bounded, incomplete map. More connections may exist.</p>}
    {universe.cache?.stale && <p className="guidance-note">Cached metadata may be out of date.</p>}
  </aside>
}
