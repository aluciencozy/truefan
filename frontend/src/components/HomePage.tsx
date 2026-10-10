import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { api } from '../lib/api'
import type { UniverseSearchResult } from '../lib/types'

// Decorative media artwork from the Figma hero, not story facts or relationships.
const artwork = [
  [330, 305, 32, 'anime-1-32', 0.18], [430, 185, 40, 'anime-2-40', 0.24],
  [540, 250, 32, 'anime-1-32', 0.22], [575, 115, 28, 'anime-2-28', 0.16],
  [695, 255, 36, 'anime-1-36', 0.13], [815, 145, 28, 'anime-2-28', 0.2],
  [830, 295, 40, 'anime-1-40', 0.14], [1015, 225, 32, 'anime-2-32', 0.22],
  [930, 365, 28, 'anime-1-28', 0.2], [1100, 335, 44, 'anime-2-44', 0.15],
  [970, 475, 32, 'anime-1-32', 0.2], [760, 470, 36, 'anime-2-36', 0.22],
  [645, 560, 28, 'anime-1-28', 0.14], [505, 490, 40, 'anime-2-40', 0.24],
  [380, 410, 32, 'anime-1-32', 0.18], [700, 345, 28, 'anime-2-28', 0.12],
] as const

function GuestLinks() {
  return <><Link to="/auth/sign-in">Log in</Link><Link className="home-signup" to="/auth/sign-up">Sign up</Link></>
}

function AccountLinks() {
  const session = authClient!.useSession()
  if (session.isPending) return <span role="status">Checking account…</span>
  return session.data
    ? <><Link to="/explore">Explore</Link><Link className="home-signup" to="/account/settings">My account</Link></>
    : <GuestLinks />
}

export default function HomePage() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<UniverseSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const [focused, setFocused] = useState(false)
  const searchController = useRef<AbortController | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()
  const reduced = useReducedMotion()

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

  return <div className="home-page">
    <header className="home-header">
      <Link className="home-brand" to="/" aria-label="TrueFan home">
        <img src="/home/brand.svg" width="30" height="30" alt="" />TrueFan
      </Link>
      <nav className="home-account" aria-label="Account"><Link to="/community">Community</Link>{authClient ? <AccountLinks /> : <GuestLinks />}</nav>
    </header>
    <main className="home-hero celestial">
      <div className="home-graph" aria-hidden="true">
        <img className="home-glow" src="/home/glow.svg" width="1100" height="680" alt="" />
        <img className="home-connections" src="/home/connections.svg" width="1440" height="724" alt="" />
        {artwork.map(([x, y, size, image, opacity], index) => <img key={index} className="home-node"
          src={`/home/${image}.png`} width={size} height={size} alt=""
          style={{ opacity, left: `${x / 1440 * 100}%`, top: `${y / 724 * 100}%`, width: `${size / 1440 * 100}%` }} />)}
      </div>
      <motion.section className="home-search" aria-labelledby="home-title" initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .7 }}>
        <div className="home-introduction">
          <h1 id="home-title">TrueFan</h1>
          <p>Your story. Your pace. Your connections.</p>
        </div>
        <div className="home-search-box" onFocus={() => setFocused(true)} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}>
        <form className="home-search-form" role="search" onSubmit={event => {
          event.preventDefault()
          if (!query.trim()) navigate('/explore')
          else void search(true)
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
        <p className="home-guidance">Find a story. Set your progress. Explore its connections.</p>
      </motion.section>
    </main>
    <footer className="home-footer"><span>Explore at your own pace.</span><span>Made for the stories you love.</span></footer>
  </div>
}
