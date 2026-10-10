import type { FormEvent } from 'react'
import type { Media } from '../lib/types'

export default function MediaControls({ query, onQuery, onSearch, results, media, onSelect, searching }: {
  query: string; onQuery: (value: string) => void; onSearch: () => void
  results: Media[]; media: Media | null; onSelect: (media: Media) => void
  searching: boolean
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
        {item.cover_url && <img src={item.cover_url} alt="" loading="lazy" />}<div><strong>{item.title}</strong><span>{item.format || item.type} / {item.total_units} {item.progress_unit}s</span></div>
      </button>) : <p className="text-sm">No matching media. Try another title.</p>}
    </div>
  </aside>
}
