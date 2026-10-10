import type { FormEvent } from 'react'
import type { Media } from '../lib/types'

export default function MediaControls({ query, onQuery, onSearch, results, media, onSelect, progress, onProgress, searching }: {
  query: string; onQuery: (value: string) => void; onSearch: () => void
  results: Media[]; media: Media | null; onSelect: (media: Media) => void
  progress: number; onProgress: (unit: number) => void; searching: boolean
}) {
  function submit(event: FormEvent) { event.preventDefault(); onSearch() }
  return <aside className="panel controls" aria-label="Media and progress">
    <h2>Your story</h2>
    <form onSubmit={submit} className="mt-5">
      <label htmlFor="search">Find media</label>
      <input id="search" maxLength={200} value={query} onChange={event => onQuery(event.target.value)} placeholder="Try Fate or Steins;Gate" />
      <button type="submit" className="primary mt-3 w-full" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
    </form>
    <div className="mt-5" aria-label="Search results">
      {searching ? <p role="status">Searching for stories…</p> : results.length ? results.map(item => <button className="media-result" key={item.id}
        aria-pressed={item.id === media?.id} onClick={() => onSelect(item)}>
        <strong>{item.title}</strong><span>{item.format || item.type} / {item.total_units} {item.progress_unit}s</span>
      </button>) : <p className="text-sm">No matching media. Try another title.</p>}
    </div>
    {media ? <div className="progress-section">
      <h3 className="font-semibold">{media.title}</h3><p className="text-sm">{media.description}</p>
      <label htmlFor="progress">Finished {media.progress_unit}</label>
      <select id="progress" value={progress} onChange={event => onProgress(Number(event.target.value))}>
        <option value={0}>Not started</option>
        {Array.from({ length: media.total_units }, (_, i) => <option key={i + 1} value={i + 1}>{media.has_prologue ? i === 0 ? 'Prologue (episode 0)' : `Episode ${i}` : `${media.progress_unit} ${i + 1}`}</option>)}
      </select>
      <p className="text-sm">{media.anilist_id ? 'AI facts are filtered by source episode. Errors and spoilers are possible.' : 'Only information revealed by this point will appear.'}</p>
    </div> : null}
  </aside>
}
