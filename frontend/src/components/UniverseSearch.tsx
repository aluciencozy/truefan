import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { UniverseSearchResult } from '../lib/types'

export default function UniverseSearch({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  const [suggestions, setSuggestions] = useState<UniverseSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const [focused, setFocused] = useState(false)
  const searchController = useRef<AbortController | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  async function search(discover: boolean) {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchController.current?.abort()
    const controller = new AbortController(); searchController.current = controller
    setSearching(true); setMessage(discover ? 'Finding your universe…' : '')
    try {
      const data = await api.searchUniverses(query.trim(), discover, controller.signal)
      if (controller.signal.aborted) return
      setSuggestions(data.results); setMessage('')
      if (discover) {
        if (data.auto_open && data.results[0]) navigate(`/explore?media=${encodeURIComponent(data.results[0].entry_media_id)}`)
        else setMessage(data.results.length ? 'Choose a universe, or refine your search.' : 'No universe found. Try a more specific title.')
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Search unavailable. Try again.')
    } finally { if (!controller.signal.aborted) setSearching(false) }
  }

  useEffect(() => {
    if (!query.trim()) { setSearching(false); return }
    searchTimer.current = setTimeout(() => void search(false), 250)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); searchController.current?.abort() }
  }, [query])

  return <div className="home-search-box" onFocus={() => setFocused(true)} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
  }}>
    <form className="home-search-form" role="search" onSubmit={event => {
      event.preventDefault()
      if (query.trim()) void search(true)
    }}>
      <img src="/home/search.svg" width="22" height="22" alt="" />
      <label className="sr-only" htmlFor="home-query">Search for a universe</label>
      <input id="home-query" type="search" maxLength={200} value={query} onChange={event => {
        searchController.current?.abort(); setQuery(event.target.value); setSuggestions([]); setMessage(''); setSearching(Boolean(event.target.value.trim()))
      }} onKeyDown={event => { if (event.key === 'Escape') setFocused(false) }}
        aria-describedby="home-search-status"
        placeholder="Search universes or anime titles..." autoComplete="off" />
    </form>
    {focused && query.trim() && <div className="home-suggestions" aria-label="Universe suggestions">
      <p id="home-search-status" role="status">{searching ? message || 'Finding universes…' : message || (suggestions.length ? 'Choose a universe or press Enter.' : 'Press Enter to discover its universe.')}</p>
      {!suggestions.length && !searching && <button type="button" onClick={() => void search(true)}>Discover this universe<img src="/home/arrow-right.svg" width="14" height="14" alt="" /></button>}
      {suggestions.map(item => <button key={item.franchise_id} type="button" onClick={() => navigate(`/explore?media=${encodeURIComponent(item.entry_media_id)}`)}>
        {item.cover_url && <img src={item.cover_url} width="28" height="38" alt="" />}
        <span>{item.title}<small>Connected stories</small></span>
        <img src="/home/arrow-right.svg" width="14" height="14" alt="" />
      </button>)}
    </div>}
  </div>
}
