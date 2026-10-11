import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import AppNavbar from './AppNavbar'
import GlitterStars from './GlitterStars'
import { api } from '../lib/api'
import type { TrendingCover } from '../lib/types'
import UniverseSearch from './UniverseSearch'
import SurpriseLauncher from './SurprisePick'

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
    <AppNavbar />
    <main className="home-hero celestial">
      <GlitterStars />
      <div className="home-graph" aria-hidden="true">
        <img className="home-glow" src="/home/glow.svg" width="1100" height="680" alt="" />
        <img className="home-connections" src="/home/connections.svg" width="1440" height="724" alt="" />
        {artwork.map(([x, y, size, opacity], index) => <span key={index} className="home-node"
          style={{ opacity: Math.min(.8, opacity * 3), animationDelay: `${index * -.7}s`, left: `${x / 1440 * 100}%`, top: `${y / 724 * 100}%`, width: `${size * 2.1 / 1440 * 100}%` }}>
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
        <SurpriseLauncher covers={covers} />
      </motion.section>
    </main>
    <footer className="home-footer"><span>Explore at your own pace.</span><span>Made for the stories you love.</span></footer>
  </div>
}
