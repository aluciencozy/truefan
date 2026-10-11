import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { authClient } from '../lib/auth'
import { usePageReady } from '../lib/pageTransition'
import { libraryApi, libraryStats } from '../lib/library'
import type { LibraryService, SavedUniverse } from '../lib/library'
import { badgeTrack, browserStorage, celebrationCopy, celebrationFor, celebrationKey, defaultAvatar, highestBadge, markCelebrated, pointRules, profileApi, rankProgress, readCelebrated, trackValueText } from '../lib/profile'
import type { BadgeTrack as Track, Celebration, Profile, ProfileService, TrackNode } from '../lib/profile'
import AppNavbar from './AppNavbar'
import GlitterStars from './GlitterStars'
import './ProfilePage.css'

interface Viewer { id: string; name: string; createdAt?: string | number | Date | null }
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
const longDate = (value: string | number | Date) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const explorerLink = (item: SavedUniverse) => `/explore?universe=${encodeURIComponent(item.media_id)}`

function ConnectedProfile() {
  const session = authClient!.useSession()
  const user = session.data?.user
  return <ProfileScreen key={user?.id ?? 'guest'} pending={session.isPending}
    viewer={user ? { id: user.id, name: user.name || 'Fan', createdAt: user.createdAt } : null} />
}
export default function ProfilePage() {
  return <div className="profile-page"><GlitterStars /><AppNavbar />{authClient ? <ConnectedProfile /> : <ProfileScreen viewer={null} />}</div>
}

function Section({ title, index, className = '', children }: { title: string; index: number; className?: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  return <motion.section className={`profile-card ${className}`} aria-label={title}
    initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
    transition={{ duration: .35, delay: reduced ? 0 : index * .06, ease: 'easeOut' }}>{children}</motion.section>
}

function BadgeArt({ src, earned, size }: { src: string | null; earned: boolean; size: number }) {
  return src
    ? <img className={`profile-badge-art${earned ? '' : ' locked'}`} src={src} width={size} height={size} alt="" />
    : <span className="profile-badge-empty" style={{ width: size, height: size }} aria-hidden="true">✦</span>
}

function LockIcon() {
  return <svg className="track-lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
}

function TrackNodeView({ node, open, onToggle }: { node: TrackNode; open: boolean; onToggle: (id: string | null) => void }) {
  return <li className={`track-node ${node.state}`} data-open={open || undefined} style={{ '--pos': `${node.position}%`, '--eq-pos': `${node.equalPosition}%` } as CSSProperties}>
    <button type="button" className="track-node-button" aria-describedby={`tip-${node.id}`} aria-label={`${node.title} badge, ${node.state === 'earned' ? 'earned' : 'locked'}`}
      onClick={() => onToggle(open ? null : node.id)} onBlur={() => onToggle(null)} onKeyDown={event => { if (event.key === 'Escape') onToggle(null) }}>
      <span className="track-badge"><BadgeArt src={node.badge} earned={node.state === 'earned'} size={52} />{node.state !== 'earned' && <LockIcon />}</span>
      <b>{node.title}</b><small>{node.minPoints} pts</small>
    </button>
    <span role="tooltip" id={`tip-${node.id}`} className="track-tip">{node.tooltip}</span>
  </li>
}

/** One scale from 0 to the top threshold: a segment per milestone gap, a badge node at each badge milestone. */
function BadgeTrackView({ profile, track }: { profile: Profile; track: Track }) {
  const reduced = useReducedMotion()
  const [grown, setGrown] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    if (reduced) return
    const timer = setTimeout(() => setGrown(true), 60)
    return () => clearTimeout(timer)
  }, [reduced])
  const show = grown || reduced
  return <div className="badge-track">
    <div className="track-bar" role="progressbar" aria-label="Badge progress" aria-valuemin={0} aria-valuemax={track.max}
      aria-valuenow={Math.min(profile.points, track.max)} aria-valuetext={trackValueText(profile.points, track.max, profile.rank, profile.next_rank)}>
      {track.segments.map((segment, index) => <span key={segment.to} className="track-segment" style={{
        '--start': `${segment.start}%`, '--end': `${segment.end}%`, '--eq-start': `${segment.equalStart}%`, '--eq-end': `${segment.equalEnd}%`,
      } as CSSProperties}><span className="track-rail"><i className={segment.fill >= 100 ? 'full' : ''} style={{ width: `${show ? segment.fill : 0}%`, transitionDelay: `${index * .35}s` }} /></span></span>)}
    </div>
    <ul className="track-nodes" aria-label="Badges">
      {track.nodes.map(node => <TrackNodeView key={node.id} node={node} open={open === node.id} onToggle={setOpen} />)}
    </ul>
  </div>
}

function RankUp({ celebration, onClose }: { celebration: Celebration; onClose: () => void }) {
  const { badge } = celebration
  const copy = celebrationCopy(celebration)
  const ref = useRef<HTMLDialogElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className="rank-up" aria-labelledby="rank-up-title" onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="rank-up-inner">
      <motion.div className="rank-up-badge" initial={reduced ? false : { scale: .2, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 14, delay: .1 }}>
        <BadgeArt src={badge.image} earned size={150} />
      </motion.div>
      <h2 id="rank-up-title">{copy.heading}</h2>
      <p>{copy.body}</p>
      <button className="profile-button primary" onClick={onClose}>Continue</button>
    </div>
  </dialog>
}

export function ProfileScreen({ viewer, pending = false, profileService = profileApi, libraryService = libraryApi }:
  { viewer: Viewer | null; pending?: boolean; profileService?: ProfileService; libraryService?: LibraryService }) {
  const [data, setData] = useState<{ owner: string; profile: Profile; items: SavedUniverse[] } | null>(null)
  const [loading, setLoading] = useState(Boolean(viewer))
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [favoriteError, setFavoriteError] = useState('')
  const [celebrate, setCelebrate] = useState<Celebration | null>(null)
  const mutation = useRef<AbortController | null>(null)
  usePageReady(!pending && !loading)
  useEffect(() => {
    const controller = new AbortController()
    mutation.current?.abort()
    setData(null); setError(''); setFavoriteError(''); setPicking(false); setBusy(false); setCelebrate(null)
    setLoading(Boolean(viewer))
    if (viewer) Promise.all([profileService.get(controller.signal), libraryService.list(controller.signal)]).then(([profile, items]) => {
      if (controller.signal.aborted) return
      setData({ owner: viewer.id, profile, items })
      setCelebrate(celebrationFor(profile.badges, readCelebrated(browserStorage(), celebrationKey(viewer.id)), profile.ranks))
    }).catch(failure => { if (!controller.signal.aborted) setError(message(failure)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); mutation.current?.abort() }
  }, [viewer?.id, retry, profileService, libraryService])

  async function chooseFavorite(mediaId: string | null) {
    if (!viewer || busy) return
    const controller = new AbortController(); mutation.current = controller
    setBusy(true); setFavoriteError('')
    try {
      const profile = await profileService.setFavorite(mediaId, controller.signal)
      if (controller.signal.aborted) return
      setData(previous => previous?.owner === viewer.id ? { ...previous, profile } : previous)
      setPicking(false)
    } catch (failure) { if (!controller.signal.aborted) setFavoriteError(message(failure)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function dismiss() {
    if (viewer && celebrate) for (const id of celebrate.unseen) markCelebrated(browserStorage(), celebrationKey(viewer.id), id)
    setCelebrate(null)
  }

  if (pending || loading) return <main className="profile-main"><section className="profile-empty" role="status"><span className="profile-empty-star">✦</span><h2>Charting your profile…</h2></section></main>
  if (!viewer) return <main className="profile-main"><section className="profile-empty"><img src={defaultAvatar} width="96" height="96" alt="" />
    <h2>Sign in to see your profile</h2><p>Your rank, badges and favorite universe live here once you’re signed in.</p>
    <Link className="profile-button primary" to="/auth/sign-in">Sign in</Link></section></main>
  if (error || !data) return <main className="profile-main"><section className="profile-empty"><h2>We lost the signal</h2><p role="alert">{error}</p>
    <button className="profile-button primary" onClick={() => setRetry(value => value + 1)}>Try again</button></section></main>

  const { profile, items } = data
  const stats = libraryStats(items)
  const progress = rankProgress(profile)
  const track = badgeTrack(profile.points, profile.ranks, profile.badges)
  const earnedBadge = highestBadge(profile.badges, profile.ranks)
  const earnedIds = new Set(profile.badges.map(badge => badge.id))
  const shelf = profile.ranks.filter(rank => rank.badge)
  const tiles = [
    { label: 'Universes saved', value: stats.universesSaved }, { label: 'Worlds completed', value: stats.worldsCompleted },
    { label: 'Universes completed', value: stats.universesCompleted },
    { label: 'Est. hours watched', value: stats.estimatedHours.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
  ]
  const favorite = profile.favorite

  return <main className="profile-main">
    <h1 className="profile-title">Your profile</h1>
    <div className="profile-grid">
      <Section title="Identity" index={0} className="profile-identity">
        <img className="profile-avatar" src={defaultAvatar} width="120" height="120" alt="Default avatar" />
        <div className="profile-identity-copy">
          <h2>{viewer.name}</h2>
          <p className="profile-rank-title">{profile.rank.title}</p>
          {viewer.createdAt ? <p className="profile-muted">Member since {longDate(viewer.createdAt)}</p> : null}
        </div>
        <div className="profile-current-badge">
          <BadgeArt src={earnedBadge?.image ?? null} earned={Boolean(earnedBadge)} size={72} />
          <small>{earnedBadge ? `${earnedBadge.title} badge` : 'First badge: ' + (shelf[0]?.title ?? 'coming soon')}</small>
        </div>
      </Section>

      <Section title="Rank progress" index={1} className="profile-rank">
        <div className="profile-points"><b>{profile.points}</b><span>{profile.points === 1 ? 'point' : 'points'}</span><em>{profile.rank.title}</em></div>
        <BadgeTrackView profile={profile} track={track} />
        <p className="profile-progress-label">{progress.label}</p>
        <details className="profile-how">
          <summary>How points work</summary>
          <ul>{pointRules.map(rule => <li key={rule.label}><span><b>{rule.label}</b><small>{rule.detail}</small></span><em>+{rule.points}</em></li>)}</ul>
          <p className="profile-muted">Your points: {profile.breakdown.world_completed} worlds · {profile.breakdown.universe_completed} universe bonuses · {profile.breakdown.universe_saved} saves · {profile.breakdown.community_post} posts</p>
        </details>
      </Section>
    </div>

    <ul className="profile-stats" aria-label="Your stats">
      {tiles.map(tile => <li key={tile.label}><b>{tile.value}</b><span>{tile.label}</span></li>)}
    </ul>

    <div className="profile-grid">
      <Section title="Favorite universe" index={2} className="profile-favorite">
        <h2>Favorite universe</h2>
        {favorite && !picking ? <div className="favorite-card">
          <Link className="favorite-cover" to={explorerLink(favorite)} aria-label={`Open ${favorite.title}`}>
            {favorite.cover_url ? <img src={favorite.cover_url} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true }} /> : null}<span aria-hidden="true">✦</span>
          </Link>
          <div><Link to={explorerLink(favorite)}><h3>{favorite.title}</h3></Link>
            <p className="profile-muted">{favorite.viewed_count} / {favorite.total_count} worlds completed</p>
            <div className="profile-actions"><button className="profile-button" disabled={busy} onClick={() => setPicking(true)}>Change</button>
              <button className="profile-button" disabled={busy} onClick={() => void chooseFavorite(null)}>Clear</button></div></div>
        </div> : items.length ? <div className="favorite-picker">
          <p className="profile-muted">{favorite ? 'Pick a different favorite.' : 'Pick the universe you love most.'}</p>
          <ul>{items.map(item => <li key={item.media_id}><button className="favorite-option" disabled={busy} aria-pressed={favorite?.media_id === item.media_id} onClick={() => void chooseFavorite(item.media_id)}>
            <span className="favorite-thumb">{item.cover_url ? <img src={item.cover_url} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true }} /> : '✦'}</span>
            <span>{item.title}</span><small>{item.viewed_count} / {item.total_count}</small></button></li>)}</ul>
          {favorite ? <button className="profile-button" onClick={() => setPicking(false)}>Cancel</button> : null}
        </div> : <div className="favorite-picker"><p className="profile-muted">Save a universe in Explore, then pick your favorite here.</p>
          <Link className="profile-button primary" to="/explore">Discover a universe</Link></div>}
        {favoriteError && <p className="profile-error" role="alert">{favoriteError}</p>}
      </Section>

      <Section title="Badges" index={3} className="profile-badges">
        <h2>Badges</h2>
        <p className="profile-muted">Your collection</p>
        <ul className="badge-shelf">{shelf.map(rank => {
          const earned = profile.badges.find(badge => badge.id === rank.id)
          return <li key={rank.id} className={earnedIds.has(rank.id) ? 'earned' : 'locked'}>
            <BadgeArt src={rank.badge} earned={earnedIds.has(rank.id)} size={84} />
            <b>{rank.title}</b>
            <small>{earned ? `Earned ${longDate(earned.earned_at)}` : `Locked · ${rank.min_points} points`}</small>
          </li>
        })}</ul>
      </Section>
    </div>
    {celebrate && <RankUp celebration={celebrate} onClose={dismiss} />}
  </main>
}
