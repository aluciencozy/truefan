import { useEffect, useRef, useState } from 'react'
import GraphCanvas from './components/GraphCanvas'
import EntityDetails from './components/EntityDetails'
import MediaControls from './components/MediaControls'
import AuthPanel from './components/AuthPanel'
import { api } from './lib/api'
import type { GraphResponse, Media } from './lib/types'

export default function App() {
  const [health, setHealth] = useState('Connecting to backend…')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Media[]>([])
  const [media, setMedia] = useState<Media | null>(null)
  const [progress, setProgress] = useState(1)
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const searchController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal).then(() => setHealth('Backend connected')).catch(() => {
      if (!controller.signal.aborted) setHealth('Backend unavailable')
    })
    api.search('', controller.signal).then(items => { setResults(items); setMedia(items[0] ?? null) }).catch(error => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => { controller.abort(); searchController.current?.abort() }
  }, [])

  useEffect(() => {
    if (!media) return
    const controller = new AbortController()
    api.graph(media.id, progress, controller.signal).then(data => { setGraph(data); setError('') }).catch(error => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [media, progress])

  async function search() {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearching(true); setError('')
    try { setResults(await api.search(query, controller.signal)) }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Search failed.') }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }

  // Hide the previous response immediately on any progress change, including rewinds.
  const visibleGraph = graph?.media_id === media?.id && graph?.progress.unit === progress ? graph : null
  const selected = visibleGraph?.entities.find(entity => entity.id === selectedId)

  return <div className="app-shell">
    <header className="app-header"><div><div className="brand">Story atlas</div>
      <h1>Follow the story.<br />Keep the mystery.</h1>
      <p>A spoiler-aware media knowledge graph, one reveal at a time.</p></div>
      <div className="header-meta"><span role="status" className="connection">{health}</span><AuthPanel /></div>
    </header>
    <main className="workspace">
      <MediaControls query={query} onQuery={setQuery} onSearch={() => void search()} results={results}
        media={media} onSelect={item => { setMedia(item); setProgress(1); setSelectedId(null); setGraph(null) }}
        progress={progress} onProgress={unit => { setProgress(unit); setSelectedId(null); setGraph(null) }} searching={searching} />
      <section className="graph-panel" aria-label="Graph explorer">
        <div className="graph-heading"><div><h2>{media?.title || 'Choose your story'}</h2>
          <p>{media ? progress === 0 ? 'Your story has not started yet' : `Through ${media.progress_unit} ${progress}` : 'Search for media to get started'}</p></div>
          <span className="tag">{visibleGraph ? `${visibleGraph.entities.length} revealed entities` : 'Waiting for graph'}</span></div>
        {error ? <div role="alert" className="error">{error} Start FastAPI on port 8000, then <button onClick={() => window.location.reload()}>retry</button>.</div>
          : visibleGraph ? visibleGraph.entities.length ? <GraphCanvas key={`${media?.id}-${progress}`} graph={visibleGraph} onSelect={setSelectedId} />
            : <div className="empty">Advance your progress to reveal your first connections.</div>
          : <div className="empty" role="status">{media ? 'Loading your graph…' : 'Waiting for media from the backend…'}</div>}
        <div className="graph-footer">Select a node to explore. Pan and zoom to follow its connections.</div>
      </section>
      {media ? <EntityDetails entity={selected} media={media} /> : <aside className="details panel"><h2>In focus</h2><p>Your entity details will appear here.</p></aside>}
    </main>
    <footer className="page-footer">Hackathon starter / Fictional demo data / Accounts via Neon Auth when configured</footer>
  </div>
}
