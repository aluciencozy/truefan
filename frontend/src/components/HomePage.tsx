import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { api } from '../lib/api'
import type { TrendingCover } from '../lib/types'
import UniverseSearch from './UniverseSearch'

// Decorative cover positions, not story facts or relationships.
const artwork = [
  [330, 305, 32, 0.18], [430, 185, 40, 0.24],
  [540, 250, 32, 0.22], [575, 115, 28, 0.16],
  [695, 255, 36, 0.13], [815, 145, 28, 0.2],
  [830, 295, 40, 0.14], [1015, 225, 32, 0.22],
  [930, 365, 28, 0.2], [1100, 335, 44, 0.15],
  [970, 475, 32, 0.2], [760, 470, 36, 0.22],
  [645, 560, 28, 0.14], [505, 490, 40, 0.24],
  [380, 410, 32, 0.18], [700, 345, 28, 0.12],
] as const

function GuestLinks() {
  return <><Link to="/auth/sign-in">Log in</Link><Link className="home-signup" to="/auth/sign-up">Sign up</Link></>
}

function AccountLinks() {
  const session = authClient!.useSession()
  if (session.isPending) return <span role="status">Checking account…</span>
  return session.data
    ? <Link className="home-signup" to="/account/settings">My account</Link>
    : <GuestLinks />
}

export default function HomePage() {
  const reduced = useReducedMotion()
  const [covers, setCovers] = useState<TrendingCover[]>([])

  useEffect(() => {
    const controller = new AbortController()
    api.trendingCovers(controller.signal).then(result => {
      if (!controller.signal.aborted) setCovers(result)
    }).catch(() => { /* Decorative artwork is optional; keep the neutral nodes. */ })
    return () => controller.abort()
  }, [])

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
        {artwork.map(([x, y, size, opacity], index) => <span key={index} className="home-node"
          style={{ opacity, left: `${x / 1440 * 100}%`, top: `${y / 724 * 100}%`, width: `${size / 1440 * 100}%` }}>
          {covers[index] && <img src={covers[index].cover_url} width={size} height={size} alt="" decoding="async"
            onError={event => { event.currentTarget.style.visibility = 'hidden' }} />}
        </span>)}
      </div>
      <motion.section className="home-search" aria-labelledby="home-title" initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .7 }}>
        <div className="home-introduction">
          <h1 id="home-title">TrueFan</h1>
          <p>Your story. Your pace. Your connections.</p>
        </div>
        <UniverseSearch />
        <p className="home-guidance">Find a story. Set your progress. Explore its connections.</p>
      </motion.section>
    </main>
    <footer className="home-footer"><span>Explore at your own pace.</span><span>Made for the stories you love.</span></footer>
  </div>
}
