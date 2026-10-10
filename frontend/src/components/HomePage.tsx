import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '../lib/auth'

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
  const navigate = useNavigate()

  return <div className="home-page">
    <header className="home-header">
      <Link className="home-brand" to="/" aria-label="TrueFan home">
        <img src="/home/brand.svg" width="30" height="30" alt="" />TrueFan
      </Link>
      <nav className="home-account" aria-label="Account"><Link to="/community">Community</Link>{authClient ? <AccountLinks /> : <GuestLinks />}</nav>
    </header>
    <main className="home-hero">
      <div className="home-graph" aria-hidden="true">
        <img className="home-glow" src="/home/glow.svg" width="1100" height="680" alt="" />
        <img className="home-connections" src="/home/connections.svg" width="1440" height="724" alt="" />
        {artwork.map(([x, y, size, image, opacity], index) => <img key={index} className="home-node"
          src={`/home/${image}.png`} width={size} height={size} alt=""
          style={{ opacity, left: `${x / 1440 * 100}%`, top: `${y / 724 * 100}%`, width: `${size / 1440 * 100}%` }} />)}
      </div>
      <section className="home-search" aria-labelledby="home-title">
        <div className="home-introduction">
          <h1 id="home-title">TrueFan</h1>
          <p>Your story. Your pace. Your connections.</p>
        </div>
        <form className="home-search-form" role="search" onSubmit={event => {
          event.preventDefault()
          navigate(query.trim() ? `/explore?q=${encodeURIComponent(query.trim())}` : '/explore')
        }}>
          <img src="/home/search.svg" width="22" height="22" alt="" />
          <label className="sr-only" htmlFor="home-query">Search for a story</label>
          <input id="home-query" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Search anime, series, movies..." autoComplete="off" />
          <button type="submit">Explore<img src="/home/arrow-right.svg" width="17" height="17" alt="" /></button>
        </form>
        <p className="home-guidance">Find a story. Set your progress. Explore its connections.</p>
      </section>
    </main>
    <footer className="home-footer"><span>Explore at your own pace.</span><span>Made for the stories you love.</span></footer>
  </div>
}
