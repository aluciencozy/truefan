import { useEffect, useRef, useState } from 'react'
import GraphCanvas from './components/GraphCanvas'
import UniverseCanvas from './components/UniverseCanvas'
import EntityDetails from './components/EntityDetails'
import MediaControls from './components/MediaControls'
import AuthPanel from './components/AuthPanel'
import { api } from './lib/api'
import type { GraphResponse, Media, Universe } from './lib/types'

const stages = {
  not_generated: 'No cached graph yet. Sign in with Google to generate it.',
  queued: 'Generation queued…', retrieving: 'Retrieving episode descriptions…', generating: 'Generating character relationships…',
  ready: 'Cached character graph ready.', partial: 'Partial graph available.', empty: 'No usable character information found.', failed: 'Graph generation failed. You can retry.',
}

export default function App() {
  const [health, setHealth] = useState('Connecting to backend…')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Media[]>([])
  const [media, setMedia] = useState<Media | null>(null)
  const [progress, setProgress] = useState(1)
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [universe, setUniverse] = useState<Universe | null>(null)
  const [view, setView] = useState<'characters' | 'universe'>('characters')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [searching, setSearching] = useState(false)
  const [revision, setRevision] = useState(0)
  const attempted = useRef(new Set<string>())
  const searchController = useRef<AbortController | null>(null)
  const universeController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal).then(() => setHealth('Backend connected')).catch(() => {
      if (!controller.signal.aborted) setHealth('Backend unavailable')
    })
    api.search('', controller.signal).then(items => { setResults(items); setMedia(items[0] ?? null) }).catch(error => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => { controller.abort(); searchController.current?.abort(); universeController.current?.abort() }
  }, [])

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
        } else if (data.generation && ['queued', 'retrieving', 'generating'].includes(data.generation.status)) {
          timer = setTimeout(() => void load(), 3000)
        }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Graph unavailable.') }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [media, progress, view, revision])

  async function search() {
    searchController.current?.abort()
    const controller = new AbortController(); searchController.current = controller
    setSearching(true); setError('')
    try { setResults(await api.search(query, controller.signal)) }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Search failed.') }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }

  function select(item: Media) {
    universeController.current?.abort()
    setMedia(item); setProgress(1); setSelectedId(null); setGraph(null); setError(''); setGenerationError('')
    setView('characters')
  }

  async function openUniverse(item: Media) {
    if (!item.anilist_id) { select(item); return }
    universeController.current?.abort()
    const controller = new AbortController(); universeController.current = controller
    setMedia(item); setProgress(1); setUniverse(null); setGraph(null); setSelectedId(null); setView('universe'); setError('')
    try { const data = await api.universe(item.id, controller.signal); if (!controller.signal.aborted) setUniverse(data) }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Universe unavailable.') }
  }

  async function generate() {
    if (!media) return
    setGenerationError('')
    try {
      await api.generate(media.id, graph?.generation?.status === 'not_generated' ? 'start' : 'retry')
      setRevision(value => value + 1)
    } catch (error) { setGenerationError(error instanceof Error ? error.message : 'Generation unavailable.') }
  }

  const visibleGraph = graph?.media_id === media?.id && graph?.progress.unit === progress ? graph : null
  const selected = visibleGraph?.entities.find(entity => entity.id === selectedId)
  const generation = visibleGraph?.generation
  const running = generation && ['queued','retrieving','generating'].includes(generation.status)

  return <div className="app-shell">
    <header className="app-header"><div><div className="brand">TrueFan / Story atlas</div>
      <h1>Explore the universe.<br />Follow the story.</h1>
      <p>Media connections and experimental AI character knowledge.</p></div>
      <div className="header-meta"><span role="status" className="connection">{health}</span><AuthPanel media={media} progress={progress} onProgress={unit => { setProgress(unit); setSelectedId(null); setGraph(null) }} /></div>
    </header>
    <main className="workspace">
      <MediaControls query={query} onQuery={setQuery} onSearch={() => void search()} results={results}
        media={media} onSelect={item => void openUniverse(item)} progress={progress}
        onProgress={unit => { setProgress(unit); setSelectedId(null); setGraph(null) }} searching={searching} />
      <section className="graph-panel" aria-label="Graph explorer">
        <div className="graph-heading"><div><h2>{view === 'universe' ? 'Media universe' : media?.title || 'Choose your story'}</h2>
          <p>{view === 'universe' ? 'Select a work to open its character graph. Connections are metadata, not a watch order.' : media ? progress === 0 ? 'Not started' : media.has_prologue ? progress === 1 ? 'Through the prologue' : `Through episode ${progress - 1}` : `Through ${media.progress_unit} ${progress}` : 'Search for media to get started'}</p></div>
          {universe && view === 'characters' && <button onClick={() => { setView('universe'); setError('') }}>Back to universe</button>}</div>
        {view === 'characters' && generation && <div className="p-4" role="status">
          <strong>Experimental AI · errors and spoilers are possible.</strong><p>{stages[generation.status]}</p>
          <p>{generation.supported_units.length ? `Analyzed story units: ${generation.supported_units.join(', ')}${media?.has_prologue ? ' (unit 1 is the prologue)' : ''}.` : 'No supported episode range yet.'}</p>
          {generation.error && <p>{generation.error}</p>}
          {!running && ['not_generated','failed','partial','empty'].includes(generation.status) && <button onClick={() => void generate()}>{generation.status === 'not_generated' ? 'Generate graph' : 'Retry unavailable episodes'}</button>}
          {generationError && <p role="alert">{generationError}</p>}
        </div>}
        {error ? <div role="alert" className="error">{error} <button onClick={() => { if (view === 'universe' && media) void openUniverse(media); else setRevision(value => value + 1) }}>Retry loading</button></div>
          : view === 'universe' ? universe ? <><UniverseCanvas universe={universe} onSelect={select} />{universe.truncated && <p className="p-4">Showing a bounded part of this universe. Search another work to explore further.</p>}</> : <div className="empty" role="status">Discovering connected media…</div>
          : visibleGraph ? visibleGraph.entities.length ? <GraphCanvas key={`${media?.id}-${progress}`} graph={visibleGraph} onSelect={setSelectedId} />
            : <div className="empty">{running ? 'Building your graph…' : generation ? 'No characters are available at this progress yet.' : 'Advance your progress to reveal your first connections.'}</div>
          : <div className="empty" role="status">{media ? 'Loading cached graph…' : 'Waiting for media…'}</div>}
        <div className="graph-footer">Select a node to explore. Pan and zoom to follow its connections.</div>
      </section>
      {media ? <EntityDetails entity={selected} media={media} /> : <aside className="details panel"><h2>In focus</h2><p>Your entity details will appear here.</p></aside>}
    </main>
    <footer className="page-footer">AniList media metadata / Kitsu and TVmaze episode sources / Experimental AI / Accounts via Neon Auth</footer>
  </div>
}
