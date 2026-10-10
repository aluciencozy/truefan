import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { communityApi } from '../lib/community'
import type { LibraryItem } from '../lib/community'
import CommunityShell from './CommunityShell'
import type { CommunityViewer } from './CommunityShell'

function ConnectedLibrary() {
  const session = authClient!.useSession()
  return <LibraryScreen viewer={session.data?.user ? {name: session.data.user.name || 'Fan'} : null} />
}
export default function LibraryPage() { return authClient ? <ConnectedLibrary /> : <LibraryScreen viewer={null} /> }

function LibraryScreen({viewer}: {viewer: CommunityViewer | null}) {
  const signedIn = Boolean(viewer)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setItems([]); setError('')
    if (signedIn) {
      setLoading(true)
      communityApi.library(controller.signal).then(setItems)
        .catch(error => {if (!controller.signal.aborted) setError(error.message)})
        .finally(() => {if (!controller.signal.aborted) setLoading(false)})
    }
    return () => controller.abort()
  }, [signedIn])
  return <CommunityShell viewer={viewer}><header className="community-header"><h1>My Library ✦</h1><p>Your stories, all in one little universe.</p></header>
    {!viewer ? <section className="community-card"><h2>Your library awaits</h2><p>Sign in to see the stories whose progress you have saved.</p><Link className="community-primary" to="/auth/sign-in">Sign in with Google</Link></section>
      : error ? <p role="alert">{error}</p> : loading ? <p role="status">Finding your stories…</p> : items.length ? <div className="library-grid">{items.map(item => <Link className="community-card library-card" to={`/explore?q=${encodeURIComponent(item.title)}`} key={item.media_id}><h2>{item.title}</h2><p>{item.completed ? 'Completed ✓' : 'In your library'}</p><span>Explore this story ↗</span></Link>)}</div>
      : <section className="community-card"><h2>No saved stories yet</h2><p>Explore a story and update your episode. We’ll remember where you left off.</p><Link to="/explore">Find your next story ↗</Link></section>}
  </CommunityShell>
}
