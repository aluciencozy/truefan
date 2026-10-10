import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import GraphCanvas from './components/GraphCanvas'
import UniverseCanvas from './components/UniverseCanvas'
import UniverseDetails from './components/UniverseDetails'
import EntityDetails from './components/EntityDetails'
import MediaControls from './components/MediaControls'
import AuthPanel from './components/AuthPanel'
import { api } from './lib/api'
import { libraryApi } from './lib/library'
import { buildUniverseModel } from './lib/universeModel'
import { buildReleaseGuide, confirmProgress, unlockMedia } from './lib/universeProgression'
import type { MediaStates } from './lib/universeProgression'
import type { GraphResponse, Media, Universe, UserMediaState } from './lib/types'

const stages = {
  not_generated: 'No cached graph yet. Sign in with Google to generate it.',
  queued: 'Generation queued…', retrieving: 'Retrieving episode descriptions…', generating: 'Generating character relationships…',
  ready: 'Cached character graph ready.', partial: 'Partial graph available.', empty: 'No usable character information found.', failed: 'Graph generation failed. You can retry.',
}

export default function App() {
  const reduced = useReducedMotion()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const searchDrawer = useRef<HTMLDetailsElement>(null)
  const focusMedia = useCallback((item: Media) => { setFocusedId(item.id); setInspectorOpen(true) }, [])
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const savedUniverseId = searchParams.get('universe') || ''
  const [librarySaving, setLibrarySaving] = useState(false)
  const [libraryMessage, setLibraryMessage] = useState('')
  const libraryOperation = useRef(0)
  const [health, setHealth] = useState('Connecting to backend…')
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<Media[]>([])
  const [media, setMedia] = useState<Media | null>(null)
  const [progress, setProgress] = useState(1)
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [universe, setUniverse] = useState<Universe | null>(null)
  const [view, setView] = useState<'characters' | 'universe'>('characters')
  const [focusedId, setFocusedId] = useState('')
  const [release, setRelease] = useState(false)
  const [states, setStates] = useState<MediaStates>({})
  const [identity, setIdentity] = useState<string | null>(null)
  const identityRef = useRef<string | null>(null)
  const accountEpoch = useRef(0)
  const [stateLoading, setStateLoading] = useState(false)
  const [loadedStateKey, setLoadedStateKey] = useState('')
  const [stateRevision, setStateRevision] = useState(0)
  const [stateMessage, setStateMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [searching, setSearching] = useState(true)
  const [revision, setRevision] = useState(0)
  const attempted = useRef(new Set<string>())
  const searchController = useRef<AbortController | null>(null)
  const universeController = useRef<AbortController | null>(null)
  const model = useMemo(() => universe ? buildUniverseModel(universe) : null, [universe])
  const stateKey = identity && model ? `${identity}:${model.media.map(m => m.id).join(',')}` : ''
  const awaitingState = Boolean(stateKey) && (stateLoading || loadedStateKey !== stateKey)
  const guide = useMemo(() => model ? buildReleaseGuide(model, states) : {}, [model, states])

  const onIdentity = useCallback((id: string | null) => {
    if (identityRef.current === id) return
    accountEpoch.current++; identityRef.current = id; setIdentity(id)
    setStates({}); setStateMessage(''); setSaving(false); setStateLoading(false); setLoadedStateKey('')
    setProgress(0); setGraph(null); setSelectedId(null)
    // Returning to the universe applies the new account's entry rules before requesting character facts.
    if (universe) setView('universe')
  }, [universe])
  const onState = useCallback((state: UserMediaState) => {
    setStates(previous => ({ ...previous, [state.media_id]: state }))
  }, [])

  useEffect(() => {
    if (!identity || !model?.media.length) return
    const controller = new AbortController()
    setStateLoading(true); setStateMessage('')
    api.mediaState(model.media.map(m => m.id), controller.signal).then(saved => {
      if (!controller.signal.aborted) { setStates(previous => ({ ...previous, ...Object.fromEntries(saved.map(s => [s.media_id, s])) })); setLoadedStateKey(stateKey) }
    }).catch(error => {
      if (!controller.signal.aborted) {
        setStateMessage(error instanceof Error ? `${error.message} Viewing state could not be loaded; you can still explore.` : 'Saved viewing state unavailable. You can still explore.')
        setLoadedStateKey(stateKey)
      }
    }).finally(() => { if (!controller.signal.aborted) setStateLoading(false) })
    return () => controller.abort()
  }, [identity, model, stateRevision, stateKey])

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal).then(() => setHealth('Backend connected')).catch(() => {
      if (!controller.signal.aborted) setHealth('Backend unavailable')
    })
    setQuery(initialQuery); setSearching(true); setResults([]); setError(''); setGenerationError('')
    setMedia(null); setProgress(1); setGraph(null); setSelectedId(null); setUniverse(null); setView('characters')
    if (savedUniverseId) {
      setView('universe')
      void api.media(savedUniverseId, controller.signal).then(item => {
        if (!controller.signal.aborted) void openUniverse(item)
      }).catch(error => {if (!controller.signal.aborted) setError(error.message)})
    }
    api.search(initialQuery, controller.signal).then(items => {
      if (controller.signal.aborted) return
      setResults(items); if (!initialQuery && !savedUniverseId) setMedia(items[0] ?? null)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    return () => { controller.abort(); searchController.current?.abort(); universeController.current?.abort() }
  }, [initialQuery, savedUniverseId])

  useEffect(() => {libraryOperation.current++; setLibraryMessage(''); setLibrarySaving(false)}, [universe?.root_id, media?.id, identity])

  async function saveUniverse() {
    const id = universe?.root_id || media?.id
    if (!id || !identity || librarySaving) return
    const epoch = accountEpoch.current
    const operation = libraryOperation.current
    setLibrarySaving(true); setLibraryMessage('')
    try {
      await libraryApi.save(id)
      if (accountEpoch.current === epoch && libraryOperation.current === operation) setLibraryMessage('Universe saved. Open Saved universes to see it.')
    } catch (error) {if (accountEpoch.current === epoch && libraryOperation.current === operation) setLibraryMessage(error instanceof Error ? error.message : 'Could not save universe.')}
    finally {if (accountEpoch.current === epoch && libraryOperation.current === operation) setLibrarySaving(false)}
  }

  useEffect(() => {
    if (!media || view !== 'characters') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const data = await api.graph(media!.id, progress, controller.signal)
        if (controller.signal.aborted) return
        setGraph(data); setError('')
        if (data.generation?.status === 'not_generated' && !attempted.current.has(media!.id)) {
          attempted.current.add(media!.id)
          try { await api.generate(media!.id, 'start', controller.signal); if (!controller.signal.aborted) timer = setTimeout(() => void load(), 1000) }
          catch (error) { if (!controller.signal.aborted) setGenerationError(error instanceof Error ? error.message : 'Sign in to generate a graph.') }
        } else if (data.generation && ['queued', 'retrieving', 'generating'].includes(data.generation.status)) timer = setTimeout(() => void load(), 3000)
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Graph unavailable.') }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [media, progress, view, revision])

  async function search() {
    searchController.current?.abort()
    const controller = new AbortController(); searchController.current = controller
    setSearching(true); setError('')
    try { const items = await api.search(query, controller.signal); if (!controller.signal.aborted) setResults(items) }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Search failed.') }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }

  function enter(item: Media) {
    if (item.anilist_id && (awaitingState || saving || (universe && guide[item.id]?.status === 'locked'))) return
    setMedia(item); setProgress(Math.min(item.total_units, states[item.id]?.progress?.unit ?? (item.anilist_id ? 0 : 1)))
    setSelectedId(null); setGraph(null); setError(''); setGenerationError(''); setView('characters')
  }

  async function openUniverse(item: Media) {
    universeController.current?.abort()
    setInspectorOpen(false)
    if (searchDrawer.current) searchDrawer.current.open = false
    if (!item.anilist_id) { setUniverse(null); enter(item); return }
    const controller = new AbortController(); universeController.current = controller
    setMedia(item); setProgress(0); setUniverse(null); setGraph(null); setSelectedId(null); setView('universe'); setError(''); setExpanding(false)
    setFocusedId(item.id)
    try { const data = await api.universe(item.id, controller.signal); if (!controller.signal.aborted) { setUniverse(data); setFocusedId(data.root_id) } }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Universe unavailable.') }
  }

  async function expandUniverse() {
    if (!universe?.cache || expanding) return
    universeController.current?.abort()
    const controller = new AbortController(); universeController.current = controller
    setExpanding(true); setStateMessage('')
    try {
      const data = await api.expandUniverse(universe.root_id, universe.cache.revision, controller.signal)
      if (!controller.signal.aborted) setUniverse(data)
    } catch (error) { if (!controller.signal.aborted) setStateMessage(error instanceof Error ? error.message : 'Expansion unavailable. The existing map is preserved.') }
    finally { if (!controller.signal.aborted) setExpanding(false) }
  }

  async function changeFlags(item: Media, flags: { completed?: boolean; manual_unlocked?: boolean }) {
    if (saving || awaitingState) return
    const epoch = accountEpoch.current
    setSaving(true); setStateMessage('')
    try {
      if (identity) {
        const saved = await api.saveMediaState(item.id, flags)
        if (epoch === accountEpoch.current) onState(saved)
      } else {
        setStates(previous => flags.manual_unlocked ? unlockMedia(previous, item.id) : {
          ...previous, [item.id]: { media_id: item.id, progress: previous[item.id]?.progress ?? null,
            manual_unlocked: previous[item.id]?.manual_unlocked ?? false, completed: true },
        })
      }
      if (epoch === accountEpoch.current) setStateMessage(identity ? 'Viewing state saved.' : 'Viewing state kept for this guest session. Sign in to save it across visits.')
    } catch (error) { if (epoch === accountEpoch.current) setStateMessage(error instanceof Error ? error.message : 'Could not save viewing state. Try again.') }
    finally { if (epoch === accountEpoch.current) setSaving(false) }
  }

  function changeProgress(unit: number) {
    setProgress(unit); setSelectedId(null); setGraph(null)
    if (media && !identity) setStates(previous => confirmProgress(previous, media, unit))
  }

  async function generate() {
    if (!media) return
    setGenerationError('')
    try { await api.generate(media.id, graph?.generation?.status === 'not_generated' ? 'start' : 'retry'); setRevision(value => value + 1) }
    catch (error) { setGenerationError(error instanceof Error ? error.message : 'Generation unavailable.') }
  }

  const visibleGraph = graph?.media_id === media?.id && graph?.progress.unit === progress ? graph : null
  const selected = visibleGraph?.entities.find(entity => entity.id === selectedId)
  const generation = visibleGraph?.generation
  const running = generation && ['queued','retrieving','generating'].includes(generation.status)
  const inUniverse = view === 'universe'
  const controls = <MediaControls query={query} onQuery={setQuery} onSearch={() => void search()} results={results}
    media={media} onSelect={item => void openUniverse(item)} progress={progress} onProgress={changeProgress} searching={searching} showProgress={!inUniverse} />

  function closeCharacter() {
    setSelectedId(null)
    requestAnimationFrame(() => {
      if (selectedId) document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(selectedId)}"] .star-node`)?.focus({ preventScroll: true })
    })
  }

  return <div className="app-shell">
    <header className="app-header">
      <Link className="home-brand" to="/" aria-label="TrueFan home"><img src="/home/brand.svg" width="30" height="30" alt="" />TrueFan</Link>
      <span className="explorer-title">✧ Constellation explorer</span>
      <div className="header-meta"><Link className="app-community-link" to="/community">Community ✦</Link><span role="status" className="connection">{health}</span><AuthPanel media={inUniverse ? null : media}
        progress={Math.max(progress, media ? states[media.id]?.progress?.unit ?? 0 : 0)} onIdentity={onIdentity} onState={onState}
        onProgress={unit => { setProgress(unit); setSelectedId(null); setGraph(null) }} /></div>
    </header>
    <main className="workspace">
      <details ref={searchDrawer} className="explorer-search" open={!media}>
        <summary><img src="/home/search.svg" width="18" height="18" alt="" />{media ? 'Find another story' : 'Find your story'}</summary>
        {controls}
      </details>
      <section className="graph-panel" aria-label="Graph explorer">
        <div className="graph-heading"><div><span className="view-label">{inUniverse ? 'Your connected universe' : 'Character constellation'}</span>
          <h1>{inUniverse ? universe?.media.find(item => item.id === universe.root_id)?.title || media?.title : media?.title || 'Every story is a universe.'}</h1>
          <p>{inUniverse ? `${model?.media.length ?? 0} stories / ${model?.branches.length ?? 0} branches` : media ? progress === 0 ? 'Not started' : media.has_prologue ? progress === 1 ? 'Through the prologue' : `Through episode ${progress - 1}` : `Through ${media.progress_unit} ${progress}` : 'Choose a story to find your first constellation.'}</p></div>
          <div className="graph-actions">
            <Link to="/library">Saved universes ↗</Link>
            {media && (identity ? <button disabled={librarySaving || (inUniverse && !universe)} onClick={() => void saveUniverse()}>{librarySaving ? 'Saving…' : '＋ Save universe'}</button> : <Link to="/auth/sign-in">Sign in to save</Link>)}
            {media && !inUniverse && <label className="inline-progress" htmlFor="canvas-progress">Your progress<select id="canvas-progress" value={progress} onChange={event => changeProgress(Number(event.target.value))}>
              <option value={0}>Not started</option>
              {Array.from({ length: media.total_units }, (_, i) => <option key={i + 1} value={i + 1}>{media.has_prologue ? i === 0 ? 'Prologue' : `Episode ${i}` : `${media.progress_unit} ${i + 1}`}</option>)}
            </select></label>}
            {universe && !inUniverse && <button onClick={() => { setView('universe'); setSelectedId(null); setError('') }}>← Universe</button>}
            {inUniverse && universe && <button aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}>Selected story {inspectorOpen ? '−' : '+'}</button>}
          </div>
        </div>
        {libraryMessage && <p className="generation-note" role="status">{libraryMessage}</p>}
        {!inUniverse && generation && <div className="generation-note" role="status">
          <span>Experimental AI · errors and spoilers are possible.</span><span>{stages[generation.status]}</span>
          {!running && ['not_generated','failed','partial','empty'].includes(generation.status) && <button onClick={() => void generate()}>{generation.status === 'not_generated' ? 'Generate graph' : 'Retry unavailable episodes'}</button>}
          <details><summary>Source coverage</summary><p>{generation.supported_units.length ? `Analyzed story units: ${generation.supported_units.join(', ')}${media?.has_prologue ? ' (unit 1 is the prologue)' : ''}.` : 'No supported episode range yet.'}</p></details>
          {generation.error && <p>{generation.error}</p>}{generationError && <p role="alert">{generationError}</p>}
        </div>}
        <div className="graph-stage">
          {universe && model && <div className="universe-layer" hidden={!inUniverse}><UniverseCanvas key={universe.root_id} universe={universe} model={model} guide={guide}
            focusedId={focusedId} onFocus={focusMedia} onEnter={enter} release={release} onRelease={() => setRelease(value => !value)}
            onExpand={() => void expandUniverse()} expanding={expanding} /></div>}
          {inUniverse && !universe && !error && <div className="empty celestial" role="status"><span className="empty-star">✧</span>Discovering connected stories…</div>}
          {error ? <div role="alert" className="error">{error} <button onClick={() => { if (inUniverse && media) void openUniverse(media); else if (!media) void search(); else setRevision(value => value + 1) }}>Retry loading</button></div>
            : !inUniverse ? <motion.div className="character-layer" key={media?.id} initial={{ opacity: 0, scale: reduced ? 1 : .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduced ? 0 : .65 }}>
              {visibleGraph ? visibleGraph.entities.length ? <GraphCanvas key={`${media?.id}-${progress}`} graph={visibleGraph} onSelect={setSelectedId} selectedId={selectedId} />
                : <div className="empty celestial"><span className="empty-star">✧</span>{running ? 'Building your constellation…' : 'Your connections begin here.'}<p>{generation ? 'Choose how far you have watched to reveal available characters.' : 'Advance your progress to reveal your first connections.'}</p></div>
              : <div className="empty celestial" role="status"><span className="empty-star">✧</span>{media ? 'Finding your constellation…' : 'A whole universe is waiting.'}<p>{media ? 'Loading the knowledge revealed at your progress.' : 'Search for an anime, or explore the Lantern Harbor demo.'}</p></div>}
              {/* Unmount immediately on progress changes, including any exiting details, to avoid stale spoilers. */}
              <AnimatePresence key={`details-${media?.id}-${progress}`}>
                {selected && media && visibleGraph && <EntityDetails entity={selected} media={media} graph={visibleGraph} onSelect={setSelectedId} onClose={closeCharacter} />}
              </AnimatePresence>
            </motion.div> : null}
          {inUniverse && universe && model && <div className="universe-inspector" hidden={!inspectorOpen}>
            <button className="inspector-close" aria-label="Close story details" onClick={() => setInspectorOpen(false)}>×</button>
            {stateLoading && <p role="status">Retrieving saved viewing state…</p>}
            {identity && <button disabled={stateLoading || saving} onClick={() => setStateRevision(value => value + 1)}>Reload saved state</button>}
            <UniverseDetails media={model.media.find(item => item.id === focusedId)} universe={universe} model={model} guide={guide[focusedId]} release={release}
              busy={saving || awaitingState} onFocus={focusMedia} onEnter={enter}
              onUnlock={item => void changeFlags(item, { manual_unlocked: true })} onComplete={item => void changeFlags(item, { completed: true })} message={stateMessage} />
          </div>}
        </div>
        <footer className="graph-footer">
          <div className="map-key">{inUniverse ? <><span><i className="available-dot" />Available</span><span><i className="locked-dot" />Locked</span><span><i className="completed-dot" />Completed</span></> : <span><i className="available-dot" />Revealed at your progress</span>}</div>
          <span>{inUniverse ? 'Branches are inferred, not story chronology.' : 'Your story. Your pace.'}</span><span>Scroll to zoom · Drag to explore</span>
        </footer>
      </section>
    </main>
  </div>
}
