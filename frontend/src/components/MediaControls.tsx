import UniverseSearch from './UniverseSearch'
import type { Media } from '../lib/types'

export default function MediaControls({ initialQuery, media, progress, onProgress, showProgress = true }: {
  initialQuery: string; media: Media | null
  progress: number; onProgress: (unit: number) => void; showProgress?: boolean
}) {
  return <aside className="panel controls" aria-label="Media and progress">
    <h2>Your story</h2>
    <UniverseSearch key={initialQuery} initialQuery={initialQuery} />
    {media && showProgress ? <div className="progress-section">
      <h3 className="font-semibold">Your viewing progress</h3>
      <label htmlFor="progress">Finished {media.progress_unit}</label>
      <select id="progress" value={progress} onChange={event => onProgress(Number(event.target.value))}>
        <option value={0}>Not started</option>
        {Array.from({ length: media.total_units }, (_, i) => <option key={i + 1} value={i + 1}>{media.has_prologue ? i === 0 ? 'Prologue (episode 0)' : `Episode ${i}` : `${media.progress_unit} ${i + 1}`}</option>)}
      </select>
      <p className="text-sm">Use Account → Save progress to record viewing history when signed in.</p>
      <p className="text-sm">{media.anilist_id ? 'AI facts are filtered by source episode. Errors and spoilers are possible.' : 'Only information revealed by this point will appear.'}</p>
    </div> : null}
  </aside>
}
