import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { authClient } from '../lib/auth'
import { usePageReady } from '../lib/pageTransition'
import { libraryApi, libraryArt as art, libraryOrder, libraryStats, universeStatus } from '../lib/library'
import type { LibraryService, SavedUniverse, UniversePreferences } from '../lib/library'
import { profileApi } from '../lib/profile'
import type { ProfileService } from '../lib/profile'
import AppNavbar from './AppNavbar'
import './LibraryPage.css'
import GlitterStars from './GlitterStars'

interface Viewer { id: string; name: string }
type Modal = { kind: 'abandon' | 'rate'; item: SavedUniverse } | { kind: 'help' | 'activity' }
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
const explorerLink = (item: SavedUniverse) => `/explore?universe=${encodeURIComponent(item.media_id)}`
const iconPaths = {
  pin: 'M16 3H8l1 6-4 4v2h6v6l1 1 1-1v-6h6v-2l-4-4 1-6Z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  abandon: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  check: 'm5 12 4 4L19 6',
  arrow: 'M7 17 17 7M7 7h10v10',
  heart: 'M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11Z',
}
function Icon({ name }: { name: Exclude<keyof typeof art, 'maps'> | keyof typeof iconPaths }) {
  return name in iconPaths
    ? <svg className="library-symbol" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name as keyof typeof iconPaths]} /></svg>
    : <img src={art[name as Exclude<keyof typeof art, 'maps'>]} alt="" />
}
function LittlePlanet() {
  return <div className="library-planet" aria-hidden="true"><div className="planet-orbit"><img src="/library/planet-orbit.svg" alt="" /></div><img className="planet-body" src="/library/planet.svg" alt="" /><i className="planet-glimmer" /><span className="planet-star-one">✦</span><span className="planet-star-two">✦</span><img className="planet-dot" src="/library/planet-star.svg" alt="" /></div>
}

function ConnectedLibrary() {
  const session = authClient!.useSession()
  return <LibraryScreen key={session.data?.user.id ?? 'guest'} pending={session.isPending} viewer={session.data?.user ? {id: session.data.user.id, name: session.data.user.name || 'Fan'} : null} />
}
export default function LibraryPage() { return <div className="library-page"><GlitterStars /><AppNavbar />{authClient ? <ConnectedLibrary /> : <LibraryScreen viewer={null} />}</div> }

function Dialog({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="library-dialog" aria-labelledby="library-dialog-title" onCancel={event => {event.preventDefault(); if (!busy) onClose()}}
    onClick={event => {if (event.target === event.currentTarget && !busy) onClose()}}>
    <motion.div initial={reduced ? false : {opacity: 0, y: 24, scale: .94}} animate={{opacity: 1, y: 0, scale: 1}} transition={{type: 'spring', damping: 23, stiffness: 260}} className="library-dialog-inner">
      <button className="library-dialog-close" onClick={onClose} disabled={busy} aria-label="Close dialog">×</button>
      <LittlePlanet />
      <h2 id="library-dialog-title">{title}</h2>{children}
    </motion.div>
  </dialog>
}

function UniverseRow({item, index, menu, busy, onMenu, onAction}: {item: SavedUniverse; index: number; menu: boolean; busy: boolean;
  onMenu: (id: string | null) => void; onAction: (kind: 'abandon' | 'pin' | 'rate' | 'favorite', item: SavedUniverse) => void}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!menu) return
    const dropdown = menuRef.current
    const viewport = dropdown?.closest('.library-scroll')
    if (dropdown && viewport) {
      const bounds = dropdown.getBoundingClientRect()
      const visible = viewport.getBoundingClientRect()
      const upwardTop = dropdown.parentElement!.getBoundingClientRect().bottom - 32 - bounds.height
      if (bounds.bottom > visible.bottom - 48 && upwardTop >= visible.top + 16) {
        dropdown.style.top = 'auto'; dropdown.style.bottom = '32px'
      }
    }
    dropdown?.scrollIntoView({block: 'nearest'})
    dropdown?.querySelector('button')?.focus()
    function dismiss(event: PointerEvent) {if (!menuRef.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) onMenu(null)}
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menu, onMenu])
  const completed = universeStatus(item) === 'Completed'
  function activate(kind: 'abandon' | 'pin' | 'rate' | 'favorite') {trigger.current?.focus(); onAction(kind, item)}
  return <motion.article layout={!reduced} initial={reduced ? false : {opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} exit={reduced ? undefined : {opacity: 0, x: -35, scale: .98}} className="universe-row" aria-label={item.title}>
    <Link className="universe-cover" to={explorerLink(item)} aria-label={`Open ${item.title}`}>
      {item.cover_url ? <img src={item.cover_url} alt={`${item.title} cover`} loading="lazy" onError={event => {event.currentTarget.hidden = true}} /> : null}<span aria-hidden="true">✦</span>
    </Link>
    <div className="universe-copy"><div className="universe-title-line"><Link to={explorerLink(item)}><h2>{item.title}</h2></Link>{item.pinned && <span className="universe-pin" title="Pinned" aria-label="Pinned"><Icon name="pin" /></span>}</div>
      <p className="universe-meta">{[item.type.toUpperCase(), item.format?.replaceAll('_', ' '), `${item.total_count} ${item.total_count === 1 ? 'title' : 'titles'}`].filter(Boolean).join(' · ')}</p>
      <details className="universe-titles"><summary>{item.titles.slice(0, 3).map(title => title.title).join(' · ')}{item.titles.length > 3 ? ` · +${item.titles.length - 3} more` : ''}</summary>
        <ol>{item.titles.map(title => <li key={title.media_id}><span>{title.completed ? '✓' : '○'}</span><Link to={`/explore?universe=${encodeURIComponent(title.media_id)}`}>{title.title}</Link><small>{title.release_date?.year ?? 'Date unknown'}</small></li>)}</ol>
        <p>Release order · Unknown dates follow dated titles.</p>
      </details>
      <div className="universe-activity"><p className="universe-last">Explored {new Date(item.last_explored_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</p>{item.rating ? <span className="universe-rating" aria-label={`Your rating: ${item.rating} out of 5`}><Icon name="star" /><b>{item.rating}<small>/5</small></b></span> : null}</div>
    </div>
    <Link className="universe-map" to={explorerLink(item)} aria-label={`Resume ${item.title} map`}><div className={`constellation constellation-${index % 3}`}><img src={art.maps[index % 3]} alt="" /></div><span>{item.viewed_count ? 'Resume your map' : 'Explore connections'} <Icon name="arrow" /></span></Link>
    <div className="universe-progress"><span className={`universe-badge ${completed ? 'complete' : ''}`}><Icon name={completed ? 'check' : 'orbit'} />{completed ? 'Completed' : 'Exploring'}</span>
      <span>{item.viewed_count} / {item.total_count} viewed</span><div className="universe-progress-track" role="progressbar" aria-label={`${item.title} titles viewed`} aria-valuenow={item.viewed_count} aria-valuemin={0} aria-valuemax={item.total_count}><div style={{width: `${item.total_count ? item.viewed_count / item.total_count * 100 : 0}%`}} /></div>
      <small>{item.coverage_incomplete ? 'In your discovered titles' : 'In your tracked titles'}</small>
    </div>
    <div className="universe-menu-anchor"><button ref={trigger} className="library-icon universe-menu-trigger" aria-label={`Options for ${item.title}`} aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={() => onMenu(menu ? null : item.media_id)}><Icon name="dots" /></button>
      {menu && <div ref={menuRef} className="universe-menu" role="menu" aria-label={`${item.title} actions`} onKeyDown={event => {
        if (event.key === 'Tab') onMenu(null)
        if (event.key === 'Escape') {event.preventDefault(); onMenu(null); trigger.current?.focus()}
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }
      }}>
        <button role="menuitem" onClick={() => activate('abandon')}><Icon name="abandon" />Abandon</button>
        <button role="menuitem" onClick={() => activate('pin')}><Icon name="pin" />{item.pinned ? 'Unpin' : 'Pin'}</button>
        <button role="menuitem" onClick={() => activate('rate')}><Icon name="star" />Rate</button>
        <button role="menuitem" onClick={() => activate('favorite')}><Icon name="heart" />Set as favorite</button>
      </div>}
    </div>
  </motion.article>
}

export function LibraryScreen({viewer, pending = false, service = libraryApi, profileService = profileApi}: {viewer: Viewer | null; pending?: boolean; service?: LibraryService; profileService?: ProfileService}) {
  const [data, setData] = useState<{owner: string; items: SavedUniverse[]} | null>(null)
  const items = data && data.owner === viewer?.id ? data.items : []
  const [loading, setLoading] = useState(Boolean(viewer))
  usePageReady(!pending && !loading)
  const [error, setError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All universes')
  const [format, setFormat] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState('recent')
  const [grid, setGrid] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const epoch = useRef(0)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); epoch.current++; mutation.current?.abort()
    setData(null); setError(''); setMutationError(''); setNotice(''); setMenu(null); setModal(null); setBusy(false)
    setLoading(Boolean(viewer))
    if (viewer) service.list(controller.signal).then(items => {if (!controller.signal.aborted) setData({owner: viewer.id, items})})
      .catch(error => {if (!controller.signal.aborted) setError(message(error))})
      .finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => {controller.abort(); mutation.current?.abort(); epoch.current++}
  }, [viewer?.id, retry, service])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {event.preventDefault(); search.current?.focus()}}
    document.addEventListener('keydown', shortcut); return () => document.removeEventListener('keydown', shortcut)
  }, [])
  const ordered = useMemo(() => libraryOrder(items, sort), [items, sort])
  const visible = ordered.filter(item => (filter === 'All universes' || (filter === 'Pinned' ? item.pinned : universeStatus(item) === filter))
    && (format === 'all' || item.type === format) && [item.title, ...item.titles.map(title => title.title)].some(title => title.toLowerCase().includes(query.trim().toLowerCase())))
  const stats = useMemo(() => libraryStats(items), [items])
  async function mutate(item: SavedUniverse, preferences: UniversePreferences | null) {
    if (!viewer || busy) return
    const owner = viewer.id; const version = epoch.current; const controller = new AbortController(); mutation.current = controller
    setBusy(true); setMutationError(''); setNotice('')
    try {
      const updated = preferences ? await service.update(item.media_id, preferences, controller.signal) : await service.abandon(item.media_id, controller.signal)
      if (epoch.current !== version || controller.signal.aborted) return
      setData(previous => previous?.owner === owner ? {owner, items: preferences ? previous.items.map(row => row.media_id === item.media_id ? updated as SavedUniverse : row) : previous.items.filter(row => row.media_id !== item.media_id)} : previous)
      setModal(null); setNotice(preferences ? `${item.title} updated.` : `${item.title} removed from saved universes.`)
    } catch (error) {if (epoch.current === version && !controller.signal.aborted) setMutationError(message(error))}
    finally {if (epoch.current === version && !controller.signal.aborted) setBusy(false)}
  }
  async function favorite(item: SavedUniverse) {
    if (!viewer || busy) return
    const version = epoch.current; const controller = new AbortController(); mutation.current = controller
    setBusy(true)
    try {
      await profileService.setFavorite(item.media_id, controller.signal)
      if (epoch.current === version && !controller.signal.aborted) setNotice(`${item.title} is now your favorite universe.`)
    } catch (error) {if (epoch.current === version && !controller.signal.aborted) setMutationError(message(error))}
    finally {if (epoch.current === version && !controller.signal.aborted) setBusy(false)}
  }
  function action(kind: 'abandon' | 'pin' | 'rate' | 'favorite', item: SavedUniverse) {
    setMenu(null); setMutationError(''); setNotice('')
    if (kind === 'favorite') void favorite(item)
    else if (kind === 'pin') void mutate(item, {pinned: !item.pinned})
    else {setRating(item.rating); setModal({kind, item})}
  }
  return <main className="saved-library"><div className="library-topline"><nav aria-label="Breadcrumb"><Link to="/">Your observatory</Link><span> / </span><span>Library</span></nav><div><span>PERSONAL LIBRARY</span><button className="library-icon" aria-label="Recent exploration" onClick={() => setModal({kind: 'activity'})}><Icon name="bell" /></button><button className="library-icon" aria-label="About saved universes" onClick={() => setModal({kind: 'help'})}><Icon name="help" /></button></div></div>
    <header className="library-heading"><div><h1>Your universes</h1><p>The stories you saved, the connections you’re still discovering.</p></div><Link className="library-primary" to="/explore"><Icon name="plus" /> Discover & save</Link></header>
    <div className="library-stats"><span><b>{stats.universesSaved}</b> saved universes</span><span><b>{stats.exploring}</b> currently exploring</span><span><b>{stats.worldsCompleted}</b> titles viewed</span><span className="library-watch-time" title="22 minutes per episode and 2 hours per completed movie"><Icon name="clock" /><span><b>{stats.estimatedHours.toLocaleString(undefined, {maximumFractionDigits: 1})}</b> estimated hours watched</span></span><i /><span className="last-universe"><Icon name="orbit" />{ordered.length ? `Last explored: ${libraryOrder(items, 'recent').sort((a,b) => Date.parse(b.last_explored_at) - Date.parse(a.last_explored_at))[0].title}` : 'Your next universe is waiting'}</span></div>
    <div className="library-tools"><label className="library-search"><Icon name="search" /><input ref={search} aria-label="Search saved universes" placeholder="Search saved universes..." value={query} onChange={event => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label><button className={`library-pill ${filtersOpen ? 'selected' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><Icon name="filters" />Filters{format !== 'all' ? ' · 1' : ''}</button><label className="library-pill library-sort"><Icon name="sort" /><select aria-label="Sort saved universes" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recently explored</option><option value="saved">Recently saved</option><option value="title">Title A–Z</option></select></label></div>
    {filtersOpen && <div className="library-filter-panel"><label>Media type <select value={format} onChange={event => setFormat(event.target.value)}>{['all','anime','tv','manga','game','movie'].map(type => <option key={type} value={type}>{type === 'all' ? 'All media' : type.toUpperCase()}</option>)}</select></label><button onClick={() => {setFormat('all'); setFilter('All universes'); setQuery('')}}>Reset filters</button></div>}
    <div className="library-tabs"><div role="group" aria-label="Filter by viewing status">{['All universes','Exploring','Completed','Pinned'].map(tab => <button key={tab} aria-pressed={filter === tab} onClick={() => setFilter(tab)}>{tab}{tab === 'All universes' && <span>{items.length}</span>}</button>)}</div><div className="library-view" role="group" aria-label="Library layout"><button aria-label="List view" aria-pressed={!grid} onClick={() => setGrid(false)}><Icon name="list" /></button><button aria-label="Grid view" aria-pressed={grid} onClick={() => setGrid(true)}><Icon name="grid" /></button></div></div>
    {notice && <p className="library-notice" role="status">{notice}</p>}{mutationError && !modal && <p role="alert" className="library-error">{mutationError}</p>}
    <div className="library-content">{pending || loading ? <section className="library-empty" role="status"><div className="library-planet">✦</div><h2>Finding your universes…</h2></section>
      : error ? <section className="library-empty"><h2>We lost the signal</h2><p role="alert">{error}</p><button className="library-primary" onClick={() => setRetry(value => value + 1)}>Try again</button></section>
      : !viewer || !items.length ? <section className="library-empty"><LittlePlanet /><h2>No signals yet</h2><p>{viewer ? 'Your saved universes will appear here. Find a story and start your next adventure.' : 'Sign in to keep your universes, viewing progress, pins, and ratings together.'}</p><Link className="library-primary" to={viewer ? '/explore' : '/auth/sign-in'}>{viewer ? 'Discover a universe' : 'Sign in to save universes'}<Icon name="arrow" /></Link></section>
      : !visible.length ? <section className="library-empty"><h2>No matching universes</h2><p>Try a different title or clear your filters.</p><button className="library-primary" onClick={() => {setQuery(''); setFilter('All universes'); setFormat('all')}}>Show all universes</button></section>
      : <><div className={`library-column-labels ${grid ? 'hidden' : ''}`}><span>SAVED UNIVERSE</span><span>RELATIONSHIP MAP</span><span>YOUR PROGRESS</span></div><div className="library-scroll" role="region" aria-label="Saved universe list" tabIndex={0}><div className={`library-universes ${grid ? 'library-grid-view' : ''}`}><AnimatePresence>{visible.map((item, index) => <UniverseRow key={item.media_id} item={item} index={index} menu={menu === item.media_id} busy={busy} onMenu={setMenu} onAction={action} />)}</AnimatePresence></div></div></>}</div>
    <footer className="library-footer"><span>{visible.length} of {items.length} universes in your library</span><span>Viewed = completed titles · Ordered by release date · Discovered catalogs may be incomplete</span></footer>
    {modal && <Dialog title={modal.kind === 'abandon' ? 'Do you really want to abandon this universe?' : modal.kind === 'rate' ? 'Rate this universe' : modal.kind === 'help' ? 'Your personal observatory' : 'Your latest signal'} busy={busy} onClose={() => {if (!busy) {setModal(null); setMutationError('')}}}>
      {'item' in modal ? <><p className="dialog-universe-name">{modal.item.title}</p>{modal.kind === 'abandon' ? <><p>It will leave your saved universes. Your viewing progress stays safe, and you can save it again anytime.</p><div className="library-dialog-actions"><button className="library-pill" disabled={busy} onClick={() => setModal(null)}>Keep exploring</button><button className="library-danger" disabled={busy} onClick={() => void mutate(modal.item, null)}><Icon name="abandon" />{busy ? 'Releasing orbit…' : 'Yes, abandon'}</button></div></>
        : <><p>How much did you enjoy exploring this universe? Your rating is private.</p><div className="library-rating" role="group" aria-label="Universe rating">{[1,2,3,4,5].map(value => <button key={value} aria-label={`Rate ${value} out of 5`} aria-pressed={rating === value} className={rating !== null && value <= rating ? 'selected' : ''} onClick={() => setRating(value)} disabled={busy}><Icon name="star" /></button>)}</div><p>{rating ? `${rating} / 5 stars` : 'Choose a star to rate'}</p><div className="library-dialog-actions"><button className="library-pill" onClick={() => setRating(null)} disabled={busy || rating === null}>Clear rating</button><button className="library-primary" disabled={busy || rating === modal.item.rating} onClick={() => void mutate(modal.item, {rating})}>{busy ? 'Saving…' : 'Save rating'}</button></div></>}</>
        : modal.kind === 'help' ? <><p>Save a universe in Explore to add it here. Open a row to resume its map, or use the options menu to pin, rate, or abandon it.</p><p>A viewed title is a completed season, movie, or other story node. Episode progress and manual unlocks alone do not count. Titles follow known release dates; this is not a guaranteed story chronology.</p><p>Estimated hours watched counts each title once across your saved universes, using 22 minutes per episode and 2 hours per completed movie. Partial episode progress counts too. Manga chapters, game milestones, and manual unlocks add no watch time.</p><Link className="library-primary" to="/explore">Discover a universe<Icon name="arrow" /></Link></>
          : <><p>{ordered.length ? `You last explored ${[...items].sort((a,b) => Date.parse(b.last_explored_at) - Date.parse(a.last_explored_at))[0].title}.` : 'Your next story is waiting. Save your first universe to start tracking it here.'}</p><Link className="library-primary" to="/explore">Continue exploring<Icon name="arrow" /></Link></>}
      {mutationError && <p className="library-error" role="alert">{mutationError}</p>}
    </Dialog>}
  </main>
}
