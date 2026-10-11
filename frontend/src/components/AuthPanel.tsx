import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { authClient } from '../lib/auth'
import { defaultAvatar, highestBadge, profileApi } from '../lib/profile'
import type { Profile } from '../lib/profile'

interface Props { onIdentity?: (id: string | null) => void }

export default function AuthPanel(props: Props) {
  if (!authClient) return null
  return <ConfiguredAuth {...props} />
}

function ConfiguredAuth({ onIdentity }: Props) {
  const session = authClient!.useSession()
  const identity = session.data?.user.id ?? null
  const name = session.data?.user.name || 'Fan'
  const [standing, setStanding] = useState<{ owner: string; rank: Profile['rank']; badge: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => { if (!session.isPending) onIdentity?.(identity) }, [identity, session.isPending, onIdentity])
  // The title is a nicety: fetch it once per sign-in when the menu first opens, and stay silent on failure.
  useEffect(() => {
    if (!open || !identity || standing?.owner === identity) return
    const controller = new AbortController()
    profileApi.get(controller.signal).then(profile => {
      if (!controller.signal.aborted) setStanding({ owner: identity, rank: profile.rank, badge: highestBadge(profile.badges, profile.ranks)?.image ?? null })
    }).catch(() => undefined)
    return () => controller.abort()
  }, [open, identity, standing?.owner])
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLAnchorElement>('a')?.focus()
    function dismiss(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return <div ref={panel} className="account-panel">
    <button ref={trigger} className="account-trigger" aria-label="Account" aria-expanded={open} aria-controls="account-dropdown"
      disabled={session.isPending} onClick={() => setOpen(value => !value)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" />
      </svg>
    </button>
    <AnimatePresence>{open && <motion.div id="account-dropdown" className="account-dropdown"
      initial={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : .96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : .98 }} transition={{ duration: reduced ? 0 : .16 }}>
      {session.error ? <p role="alert">Could not load your account. Try reloading.</p> : identity ? <>
        <Link className="account-profile" to="/profile" onClick={() => setOpen(false)}>
          <img className="account-avatar" src={defaultAvatar} width="36" height="36" alt="" />
          <span className="account-identity">
            <b>{name}</b>
            <small>{standing?.owner === identity ? <>{standing.badge && <img src={standing.badge} width="16" height="16" alt="" />}{standing.rank.title}</> : 'View profile'}</small>
          </span>
        </Link>
        <Link to="/account/settings" onClick={() => setOpen(false)}>Settings</Link>
        <Link to="/auth/sign-out" onClick={() => setOpen(false)}>Log out</Link>
      </> : <Link to="/auth/sign-in" onClick={() => setOpen(false)}>Sign in with Google</Link>}
    </motion.div>}</AnimatePresence>
  </div>
}
