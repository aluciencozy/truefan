import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { authClient } from '../lib/auth'
import AuthPanel from './AuthPanel'
import './AppNavbar.css'

const BrandLink = motion.create(Link)

const destinations = [
  {
    to: '/explore',
    label: 'Explore',
    icon: <><path d="M12 3c3.8 1.7 6 5.4 6 9l-6 6-6-6c0-3.6 2.2-7.3 6-9Z" /><circle cx="12" cy="9" r="1.5" /><path d="m6 12-3 1 3 3m12-4 3 1-3 3m-8 4 2-2 2 2" /></>,
  },
  {
    to: '/library',
    label: 'Saved Universes',
    icon: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  },
  {
    to: '/community',
    label: 'Community',
    icon: <><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-30 12 12)" /><circle cx="19.8" cy="7.5" r="1" /></>,
  },
] as const

function GuestLinks() {
  return <><Link to="/auth/sign-in">Log in</Link><Link className="navbar-signup" to="/auth/sign-up">Sign up</Link></>
}

export default function AppNavbar({ onIdentity }: { onIdentity?: (id: string | null) => void }) {
  const { pathname } = useLocation()
  const reduced = useReducedMotion()

  return <header className="app-navbar">
    <BrandLink className="navbar-brand" to="/" aria-label="TrueFan home"
      whileHover={{ scale: 1.12, rotate: -10, y: -2 }}
      whileTap={{ scale: .96, rotate: 0, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
      <img src="/home/truefan-logo.svg" width="52" height="52" alt="" />
    </BrandLink>
    <nav className="navbar-links" aria-label="Main navigation">
      {destinations.map(({ to, label, icon }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`) || (to === '/explore' && pathname === '/')
        return <Link key={to} to={to} className={`navbar-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
          {active && <motion.span className="navbar-indicator" aria-hidden="true"
            initial={reduced ? false : { opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
          <svg className="navbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
          <span className="navbar-label">{label}</span>
        </Link>
      })}
    </nav>
    <div className="navbar-account" aria-label="Account">
      {authClient ? <AuthPanel onIdentity={onIdentity} /> : <GuestLinks />}
    </div>
  </header>
}
