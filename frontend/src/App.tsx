import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import GraphCanvas from './components/GraphCanvas'
import UniverseCanvas from './components/UniverseCanvas'
import UniverseDetails from './components/UniverseDetails'
import EntityDetails from './components/EntityDetails'
import MediaControls from './components/MediaControls'
import AppNavbar from './components/AppNavbar'
import ProgressControl from './components/ProgressControl'
import { api } from './lib/api'
import { libraryApi } from './lib/library'
import { usePageReady } from './lib/pageTransition'
import { buildUniverseModel } from './lib/universeModel'
import { buildReleaseGuide, confirmProgress, unlockMedia, worldTitle } from './lib/universeProgression'
import type { MediaStates } from './lib/universeProgression'
import type { GraphResponse, Media, Universe, UserMediaState } from './lib/types'

const stages = {
  not_generated: 'Discover the characters revealed at your progress.',
  queued: 'Preparing your constellation…', retrieving: 'Reading the story so far…', generating: 'Connecting the characters…',
  ready: 'Your constellation is ready.', partial: 'Some connections are ready to explore.', empty: 'No character connections are available at this point.', failed: 'We couldn’t build this constellation. Try again.',
}

export default function App() {
  const reduced = useReducedMotion()
  const searchDialog = useRef<HTMLDialogElement>(null)
  const focusMedia = useCallback((item: Media) => { setFocusedId(item.id) }, [])
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const initialMedia = searchParams.get('media') || searchParams.get('universe') || ''
  const [librarySaving, setLibrarySaving] = useState(false)
  const [libraryMessage, setLibraryMessage] = useState('')
  const libraryOperation = useRef(0)
  const [media, setMedia] = useState<Media | null>(null)
  const [progress, setProgress] = useState(1)
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [universe, setUniverse] = useState<Universe | null>(null)
  const [view, setView] = useState<'characters' | 'universe'>('characters')
  const [focusedId, setFocusedId] = useState('')
  const release = false
  const [states, setStates] = useState<MediaStates>({})
  const [identity, setIdentity] = useState<string | null>(null)
  const identityRef = useRef<string | null>(null)
  const accountEpoch = useRef(0)
  const [stateLoading, setStateLoading] = useState(false)
  const [loadedStateKey, setLoadedStateKey] = useState('')
  const saveQueue = useRef(Promise.resolve())
  const latestProgress = useRef<object | null>(null)
  const [progressMessage, setProgressMessage] = useState('')
  const [stateMessage, setStateMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loadRevision, setLoadRevision] = useState(0)
  const attempted = useRef(new Set<string>())
  const universeController = useRef<AbortController | null>(null)
  const model = useMemo(() => universe ? buildUniverseModel(universe) : null, [universe])
  const stateIds = model ? model.media.map(m => m.id) : media ? [media.id] : []
  const stateKey = identity && stateIds.length ? `${identity}:${stateIds.join(',')}` : ''
  const awaitingState = Boolean(stateKey) && (stateLoading || loadedStateKey !== stateKey)
  const guide = useMemo(() => model ? buildReleaseGuide(model, states) : {}, [model, states])

  const onIdentity = useCallback((id: string | null) => {
    if (identityRef.current === id) return
    accountEpoch.current++; identityRef.current = id; setIdentity(id)
    setStates({}); setStateMessage(''); setSaving(false); setStateLoading(false); setLoadedStateKey('')
    latestProgress.current = null; setProgressMessage('')
    setProgress(0); setGraph(null); setSelectedId(null)
    // Returning to the universe applies the new account's entry rules before requesting character facts.
    if (universe) setView('universe')
  }, [universe])
  const onState = useCallback((state: UserMediaState) => {
    setStates(previous => ({ ...previous, [state.media_id]: state }))
  }, [])

  useEffect(() => {
    if (!stateKey) return
    const controller = new AbortController()
    setStateLoading(true); setStateMessage('')
    api.mediaState(stateIds, controller.signal).then(saved => {
      if (!controller.signal.aborted) {
        setStates(previous => ({ ...previous, ...Object.fromEntries(saved.map(s => [s.media_id, s])) })); setLoadedStateKey(stateKey)
        if (!model && media) {
          setProgress(Math.min(media.total_units, saved.find(s => s.media_id === media.id)?.progress?.unit ?? 0))
          setGraph(null); setSelectedId(null)
        }
      }
    }).catch(error => {
      if (!controller.signal.aborted) {
        setStateMessage(error instanceof Error ? `${error.message} Viewing state could not be loaded; you can still explore.` : 'Saved viewing state unavailable. You can still explore.')
        setLoadedStateKey(stateKey)
      }
    }).finally(() => { if (!controller.signal.aborted) setStateLoading(false) })
    return () => controller.abort()
  }, [stateKey])

  useEffect(() => {
    const controller = new AbortController()
    setError(''); setGenerationError('')
    setMedia(null); setProgress(1); setGraph(null); setSelectedId(null); setUniverse(null); setView('characters')
    const load = initialMedia ? api.media(initialMedia, controller.signal).then(item => {
      if (!controller.signal.aborted) void openUniverse(item)
    }) : Promise.resolve()
    load.catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => { controller.abort(); universeController.current?.abort() }
  }, [initialQuery, initialMedia, loadRevision])

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
    if (!media || view !== 'characters' || awaitingState) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const data = await api.graph(media!.id, progress, controller.signal)
        if (controller.signal.aborted) return
        setGraph(data); setError('')
        if (identity && data.generation?.status === 'not_generated' && !attempted.current.has(media!.id)) {
          attempted.current.add(media!.id)
          try { await api.generate(media!.id, 'start', controller.signal); if (!controller.signal.aborted) timer = setTimeout(() => void load(), 1000) }
          catch (error) { if (!controller.signal.aborted) setGenerationError(error instanceof Error ? error.message : 'Sign in to generate a graph.') }
        } else if (data.generation && ['queued', 'retrieving', 'generating'].includes(data.generation.status)) timer = setTimeout(() => void load(), 3000)
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Graph unavailable.') }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [media, progress, view, revision, awaitingState, identity])

  function enter(item: Media) {
    if (item.anilist_id && (awaitingState || saving || (universe && guide[item.id]?.status === 'locked'))) return
    latestProgress.current = null; setProgressMessage(''); setMedia(item); setProgress(Math.min(item.total_units, states[item.id]?.progress?.unit ?? (identity || item.anilist_id ? 0 : 1)))
    setSelectedId(null); setGraph(null); setError(''); setGenerationError(''); setView('characters')
  }

  async function openUniverse(item: Media) {
    universeController.current?.abort()
    searchDialog.current?.close()
    if (!item.anilist_id) { setUniverse(null); enter(item); return }
    const controller = new AbortController(); universeController.current = controller
    latestProgress.current = null; setProgressMessage(''); setMedia(item); setProgress(0); setUniverse(null); setGraph(null); setSelectedId(null); setView('universe'); setError('')
    setFocusedId(item.id)
    try { const data = await api.universe(item.id, controller.signal); if (!controller.signal.aborted) { setUniverse(data); setFocusedId(data.root_id) } }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Universe unavailable.') }
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
          ...previous, [item.id]: { media_id: item.id, progress: item.total_units_known
            ? { unit: Math.max(previous[item.id]?.progress?.unit ?? 0, item.total_units) } : previous[item.id]?.progress ?? null,
            manual_unlocked: previous[item.id]?.manual_unlocked ?? false, completed: true },
        })
      }
      if (epoch === accountEpoch.current) setStateMessage(identity ? 'Viewing state saved.' : 'Viewing state kept for this guest session. Sign in to save it across visits.')
    } catch (error) { if (epoch === accountEpoch.current) setStateMessage(error instanceof Error ? error.message : 'Could not save viewing state. Try again.') }
    finally { if (epoch === accountEpoch.current) setSaving(false) }
  }

  function changeProgress(unit: number) {
    setProgress(unit); setSelectedId(null); setGraph(null)
    if (!media) return
    setStates(previous => confirmProgress(previous, media, unit))
    if (identity) {
      const item = media, epoch = accountEpoch.current, update = {}
      latestProgress.current = update; setProgressMessage('Saving…')
      // Serialize writes so a slower earlier episode cannot overwrite a later one.
      saveQueue.current = saveQueue.current.then(async () => {
        if (epoch !== accountEpoch.current) return
        try {
          const saved = await api.saveProgress(item.id, unit)
          if (epoch === accountEpoch.current) {
            setStates(previous => confirmProgress(previous, item, saved.progress.unit))
            if (latestProgress.current === update) setProgressMessage('Saved')
          }
        } catch {
          if (epoch === accountEpoch.current && latestProgress.current === update) setProgressMessage('Could not save progress. Check your connection and try again.')
        }
      })
    }
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
  usePageReady(!initialMedia || Boolean(error) || (!awaitingState && media?.id === initialMedia && Boolean(inUniverse ? universe : visibleGraph)))
  const headingMedia = inUniverse ? universe?.media.find(item => item.id === universe.root_id) ?? media : media
  const controls = <MediaControls initialQuery={initialQuery} />

  function closeCharacter() {
    setSelectedId(null)
    requestAnimationFrame(() => {
      if (selectedId) document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(selectedId)}"] .star-node`)?.focus({ preventScroll: true })
    })
  }

  return <div className="app-shell celestial">
    <AppNavbar onIdentity={onIdentity} />
    <main className="workspace">
      <section className="graph-panel" aria-label="Graph explorer">
        <div className="graph-heading"><div><span className="view-label">{inUniverse ? 'Your connected universe' : 'Character constellation'}</span>
          <h1>{headingMedia ? worldTitle(headingMedia, inUniverse ? guide[headingMedia.id] : undefined) : 'Every story is a universe.'}</h1>
          {inUniverse && <p>{model?.media.length ?? 0} stories</p>}</div>
          <div className="graph-actions">
            {media && (identity ? <button disabled={librarySaving || (inUniverse && !universe)} onClick={() => void saveUniverse()}>{librarySaving ? 'Saving…' : '＋ Save universe'}</button> : <Link to="/auth/sign-in">Sign in to save</Link>)}
            {universe && !inUniverse && <button onClick={() => { setView('universe'); setSelectedId(null); setError('') }}>← Universe</button>}
            {media && !inUniverse && <ProgressControl media={media} progress={progress} onProgress={changeProgress} disabled={awaitingState} />}
            <button className="explorer-search" aria-haspopup="dialog" aria-label={media ? 'Find another story' : 'Find your story'} title={media ? 'Find another story' : 'Find your story'} onClick={() => {
              searchDialog.current?.showModal()
              searchDialog.current?.querySelector('input')?.focus()
            }}><img src="/home/search.svg" width="18" height="18" alt="" /><span>{media ? 'Find another story' : 'Find your story'}</span></button>
          </div>
        </div>
        {libraryMessage && <p className="generation-note" role="status">{libraryMessage}</p>}
        <div className="graph-stage">
          {universe && model && <div className="universe-layer" hidden={!inUniverse}><UniverseCanvas key={universe.root_id} universe={universe} model={model} guide={guide}
            focusedId={focusedId} active={inUniverse} onFocus={focusMedia} release={release}
            onEnter={enter} details={beginEntry => <>
              {stateLoading && <p className="state-notice" role="status">Retrieving saved viewing state…</p>}
              <UniverseDetails media={model.media.find(item => item.id === focusedId)} universe={universe} model={model} guide={guide} release={release}
                state={states[focusedId]} busy={saving || awaitingState} onFocus={focusMedia} onEnter={beginEntry}
                onUnlock={item => void changeFlags(item, { manual_unlocked: true })} onComplete={item => void changeFlags(item, { completed: true })} message={stateMessage} />
            </>} /></div>}
          {inUniverse && !universe && !error && <div className="empty celestial" role="status"><span className="empty-star">✧</span>Discovering connected stories…</div>}
          {error ? <div role="alert" className="error">{error} <button onClick={() => { if (inUniverse && media) void openUniverse(media); else if (!media) setLoadRevision(value => value + 1); else setRevision(value => value + 1) }}>Retry loading</button></div>
            : !inUniverse ? <motion.div className="character-layer" key={media?.id} initial={{ opacity: 0, scale: reduced ? 1 : .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduced ? 0 : .65 }}>
              {!awaitingState && generation && generation.status !== 'ready' && (running || !visibleGraph?.entities.length) ? <div className="empty celestial character-status" role="status" aria-live="polite">
                <span className="empty-star" aria-hidden="true">✧</span>
                <h2>{running ? 'Building your constellation…' : 'Your constellation is taking shape.'}</h2>
                <p>{stages[generation.status]}</p>
                {!running && (identity ? <button onClick={() => void generate()}>{generation.status === 'not_generated' ? 'Build constellation' : 'Try again'}</button> : <Link className="constellation-signin" to="/auth/sign-in">Sign in to explore</Link>)}
                {generation.error && <p>{generation.error}</p>}{generationError && <p role="alert">{generationError}</p>}
              </div> : !awaitingState && visibleGraph ? visibleGraph.entities.length ? <GraphCanvas key={`${media?.id}-${progress}`} graph={visibleGraph} onSelect={setSelectedId} selectedId={selectedId} />
                : <div className="empty celestial"><span className="empty-star">✧</span>{running ? 'Building your constellation…' : 'Your connections begin here.'}<p>{generation ? 'Choose how far you have watched to reveal available characters.' : 'Advance your progress to reveal your first connections.'}</p></div>
              : <div className="empty celestial" role="status"><span className="empty-star">✧</span>{awaitingState ? 'Picking up where you left off…' : media ? 'Finding your constellation…' : 'A whole universe is waiting.'}<p>{media ? 'Loading the knowledge revealed at your progress.' : 'Search for a story to explore its universe.'}</p></div>}
              {/* Unmount immediately on progress changes, including any exiting details, to avoid stale spoilers. */}
              <AnimatePresence key={`details-${media?.id}-${progress}`}>
                {selected && media && visibleGraph && <EntityDetails entity={selected} media={media} graph={visibleGraph} onSelect={setSelectedId} onClose={closeCharacter} />}
              </AnimatePresence>
            </motion.div> : null}
        </div>
        <footer className="graph-footer">
          <div className="map-key">{inUniverse ? <><span><i className="available-dot" />Available</span><span><i className="locked-dot" />Locked</span><span><i className="completed-dot" />Completed</span></> : <span><i className="available-dot" />Revealed at your progress</span>}</div>
          <span role="status">{!inUniverse && progressMessage ? <>{progressMessage}{progressMessage.startsWith('Could not') && <button onClick={() => changeProgress(progress)}>Retry</button>}</> : !inUniverse && stateMessage ? stateMessage : 'Your story. Your pace.'}</span><span>{inUniverse ? 'Arrow keys to travel · Overview to see all worlds' : 'Scroll to zoom · Drag to explore'}</span>
        </footer>
      </section>
    </main>
    <dialog ref={searchDialog} className="story-search-dialog" aria-labelledby="story-search-title" onClick={event => {
      if (event.target === event.currentTarget) searchDialog.current?.close()
    }}>
      <button className="story-search-close" aria-label="Close story search" onClick={() => searchDialog.current?.close()}>×</button>
      {controls}
    </dialog>
  </div>
}
