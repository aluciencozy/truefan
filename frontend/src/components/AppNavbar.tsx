import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { authClient } from '../lib/auth'
import AuthPanel from './AuthPanel'
import './AppNavbar.css'

const BrandLink = motion.create(Link)

const destinations = [
  { to: '/explore', label: 'Explore' },
  { to: '/library', label: 'Saved Universes' },
  { to: '/community', label: 'Community' },
] as const

function GuestLinks() {
  return <><Link to="/auth/sign-in">Log in</Link><Link className="navbar-signup" to="/auth/sign-up">Sign up</Link></>
}

// Star phases, sizes, and twinkle rhythms for the Saturn ring. Positions stay
// deterministic so navigation and hydration render the same orbit every time.
const saturnStars = [
  { phase: '0deg', size: '3px', twinkle: '4.5s', delay: '0s' },
  { phase: '72deg', size: '2px', twinkle: '5.6s', delay: '-1.8s' },
  { phase: '144deg', size: '2.5px', twinkle: '6.4s', delay: '-3.1s' },
  { phase: '216deg', size: '2px', twinkle: '4.9s', delay: '-2.4s' },
  { phase: '288deg', size: '3px', twinkle: '7s', delay: '-4.2s' },
]

export default function AppNavbar({ onIdentity }: { onIdentity?: (id: string | null) => void }) {
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  // Hover (or keyboard focus) temporarily pulls the ring off the active link.
  const [hovered, setHovered] = useState<string | null>(null)

  return <header className="app-navbar">
    <BrandLink className="navbar-brand" to="/" aria-label="TrueFan home"
      whileHover={{ scale: 1.12, rotate: -10, y: -2 }}
      whileTap={{ scale: .96, rotate: 0, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
      <img src="/home/truefan-logo.svg" width="52" height="52" alt="" />
    </BrandLink>
    <nav className="navbar-links" aria-label="Main navigation">
      {destinations.map(({ to, label }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`) || (to === '/explore' && pathname === '/')
        const ringed = hovered ? hovered === to : active
        return <Link key={to} to={to} className={`navbar-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}
          onMouseEnter={() => setHovered(to)} onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(to)} onBlur={() => setHovered(null)}>
          {active && <motion.span className="navbar-indicator" aria-hidden="true"
            initial={reduced ? false : { opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
          <span className="navbar-label">{label}</span>
          {ringed && <motion.span className="navbar-saturn" aria-hidden="true" layoutId="navbar-saturn-ring"
            initial={reduced ? false : { opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 28 }}>
            <span className="saturn-tilt">
              <span className="saturn-ring saturn-ring-inner" />
              <span className="saturn-ring saturn-ring-outer" />
              {saturnStars.map((star) => <i key={star.phase} className="saturn-star" style={{
                '--saturn-phase': star.phase,
                '--saturn-size': star.size,
                '--saturn-twinkle-duration': star.twinkle,
                '--saturn-twinkle-delay': star.delay,
              } as CSSProperties} />)}
            </span>
          </motion.span>}
        </Link>
      })}
    </nav>
    <div className="navbar-account" aria-label="Account">
      {authClient ? <AuthPanel onIdentity={onIdentity} /> : <GuestLinks />}
    </div>
  </header>
}
