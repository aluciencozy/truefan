import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { authClient } from '../lib/auth'
import AuthPanel from './AuthPanel'
import './AppNavbar.css'

const destinations = [
  { to: '/explore', label: 'Explore' },
  { to: '/library', label: 'Saved Universes' },
  { to: '/community', label: 'Community' },
] as const

function GuestLinks() {
  return <><Link to="/auth/sign-in">Log in</Link><Link className="navbar-signup" to="/auth/sign-up">Sign up</Link></>
}

export default function AppNavbar({ onIdentity }: { onIdentity?: (id: string | null) => void }) {
  const { pathname } = useLocation()
  const reduced = useReducedMotion()

  return <header className="app-navbar">
    <Link className="navbar-brand" to="/" aria-label="TrueFan home">
      <img src="/home/brand.svg" width="30" height="30" alt="" />TrueFan
    </Link>
    <nav className="navbar-links" aria-label="Main navigation">
      {destinations.map(({ to, label }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`) || (to === '/explore' && pathname === '/')
        return <Link key={to} to={to} className={`navbar-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
          {active && <motion.span className="navbar-indicator" aria-hidden="true"
            initial={reduced ? false : { opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
          <span className="navbar-label">{label}</span>
        </Link>
      })}
    </nav>
    <div className="navbar-account" aria-label="Account">
      {authClient ? <AuthPanel onIdentity={onIdentity} /> : <GuestLinks />}
    </div>
  </header>
}
