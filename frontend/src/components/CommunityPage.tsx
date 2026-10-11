import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { usePageReady } from '../lib/pageTransition'
import { communityApi, examplePosts, timeAgo, visitorId } from '../lib/community'
import type { CommunityComment, CommunityFeed, CommunityPost, PostCategory, PostCreate } from '../lib/community'
import CommunityShell, { CommunityIcon, LittleUniverse } from './CommunityShell'
import type { CommunityViewer } from './CommunityShell'
import CommunityModal from './CommunityModal'
import './CommunityPage.css'

const tabs: { label: string; category: PostCategory }[] = [
  { label: 'Discussions', category: 'discussion' }, { label: 'Theories', category: 'theory' }, { label: 'Reviews', category: 'review' },
]
const blankPost = (): PostCreate => ({ category: 'discussion', media: '', title: '', body: '', contains_spoilers: false, rating: null })

function ConnectedCommunity() {
  const session = authClient!.useSession()
  return <CommunityScreen key={session.data?.user?.id || 'guest'} viewer={session.data?.user ? { id: session.data.user.id, name: session.data.user.name || 'Fan' } : null} />
}

export default function CommunityPage() { return authClient ? <ConnectedCommunity /> : <CommunityScreen viewer={null} /> }

export function CommunityScreen({ viewer, service = communityApi }: { viewer: CommunityViewer | null; service?: typeof communityApi }) {
  const signedIn = Boolean(viewer)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const linkedPostId = searchParams.get('post')
  const [category, setCategory] = useState<PostCategory | ''>('')
  const [media, setMedia] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [spoilers, setSpoilers] = useState(false)
  const [feed, setFeed] = useState<CommunityFeed | null>(null)
  const [activeFans, setActiveFans] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  usePageReady(!loading)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState<PostCreate>(blankPost)
  const [sending, setSending] = useState(false)
  const [busyLike, setBusyLike] = useState<string | null>(null)
  const [selected, setSelected] = useState<CommunityPost | null>(null)
  const [comments, setComments] = useState<CommunityComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentSpoilers, setCommentSpoilers] = useState(false)
  const [commentSending, setCommentSending] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [guidelines, setGuidelines] = useState(false)
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState('')
  const [visitor] = useState(visitorId)
  const activeThread = useRef<string | null>(null)
  activeThread.current = selected?.id || null

  useEffect(() => {
    const controller = new AbortController()
    // Clear stale posts and dialogs immediately on a filter/spoiler change.
    setFeed(null); setSelected(null); setComments([]); setLoading(true); setError('')
    const timer = setTimeout(() => {
      service.feed({ category, media, q: query.trim(), sort, spoilers, offset }, signedIn, controller.signal)
        .then(data => { if (!controller.signal.aborted) { setFeed(data); setActiveFans(data.active_fans); setOffline(false) } })
        .catch(() => {
          if (!controller.signal.aborted) { setOffline(true); setActiveFans(null); setError('') }
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [category, media, query, sort, spoilers, signedIn, revision, offset, service])

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function heartbeat() {
      if (document.visibilityState !== 'visible' || pending) return
      pending = true
      try { const data = await service.presence(visitor, category || 'discussion', signedIn, controller.signal); if (!controller.signal.aborted) setActiveFans(data.active_fans) }
      catch { if (!controller.signal.aborted) setActiveFans(null) }
      finally { pending = false }
    }
    void heartbeat()
    const interval = setInterval(() => void heartbeat(), 25000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', heartbeat) }
  }, [visitor, category, signedIn, service])

  useEffect(() => {
    if (!linkedPostId) return
    const controller = new AbortController()
    service.post(linkedPostId, spoilers, signedIn, controller.signal).then(post => {
      if (!controller.signal.aborted) setSelected(post)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [linkedPostId, spoilers, signedIn, service])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setComments([]); setCommentSending(false); setDialogError(''); setCommentBody(''); setCommentSpoilers(false); setCommentsLoading(true)
    service.comments(selected.id, spoilers, controller.signal).then(data => { if (!controller.signal.aborted) setComments(data) })
      .catch(error => { if (!controller.signal.aborted) setDialogError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setCommentsLoading(false) })
    return () => controller.abort()
  }, [selected?.id, spoilers, service])

  function closeConversation() { setSelected(null); navigate('/community', { replace: true }) }

  function requireSignIn(): boolean {
    if (viewer) return true
    if (!authClient) { setError('Google sign-in is not configured yet. Ask your team to configure Neon Auth.'); return false }
    navigate('/auth/sign-in'); return false
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!requireSignIn() || offline || sending) return
    setSending(true); setComposeError(''); setAnnouncement('')
    try {
      await service.create(draft)
      setCategory(draft.category); setMedia(''); setQuery(''); setOffset(0); setSort('latest')
      if (draft.contains_spoilers) setSpoilers(true)
      setDraft({ ...blankPost(), category: draft.category }); setRevision(value => value + 1); setAnnouncement('Your post was published.'); setComposing(false)
    } catch (error) { setComposeError(error instanceof Error ? error.message : 'Could not publish post') }
    finally { setSending(false) }
  }

  async function like(post: CommunityPost) {
    if (!requireSignIn() || offline || busyLike) return
    setBusyLike(post.id); setError(''); if (activeThread.current === post.id) setDialogError('')
    try {
      const updated = await service.like(post.id, !post.liked, spoilers)
      setFeed(current => current ? { ...current, posts: current.posts.map(item => item.id === post.id ? updated : item) } : current)
      setSelected(current => current?.id === updated.id ? updated : current)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update like'
      if (activeThread.current === post.id) setDialogError(message); else setError(message)
    }
    finally { setBusyLike(null) }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault()
    if (!selected || !commentBody.trim() || !requireSignIn() || commentSending) return
    setCommentSending(true); setDialogError('')
    const threadId = selected.id
    try {
      const comment = await service.comment(selected.id, commentBody, commentSpoilers, spoilers)
      if (activeThread.current !== threadId) return
      if (!comment.contains_spoilers || spoilers) {
        setComments(current => [...current, comment]); setSelected(current => current ? { ...current, comments: current.comments + 1 } : current)
        setFeed(current => current ? { ...current, posts: current.posts.map(post => post.id === selected.id ? { ...post, comments: post.comments + 1 } : post) } : current)
      }
      setCommentBody(''); setCommentSpoilers(false)
      setAnnouncement(comment.contains_spoilers && !spoilers ? 'Spoiler comment saved. Enable Show spoiler posts to see it.' : 'Comment posted.')
    } catch (error) { if (activeThread.current === threadId) setDialogError(error instanceof Error ? error.message : 'Could not post comment') }
    finally { if (activeThread.current === threadId) setCommentSending(false) }
  }

  const previewPosts = examplePosts.filter(post => (!category || post.category === category) && (!media || post.media === media)
    && `${post.title} ${post.body}`.toLowerCase().includes(query.toLowerCase()))
  const posts = offline ? previewPosts : feed?.posts || []
  const mediaOptions = offline ? examplePosts.map(post => post.media) : feed?.media || (media ? [media] : [])

  return <CommunityShell>
    <header className="community-header">
      <div className="community-introduction"><div><h1>Community ✦</h1><p>Talk, share theories, and leave reviews.</p></div>
        <span className="community-presence" title="Visitors active within the last 90 seconds; signed-in users are deduplicated across browsers.">
          <CommunityIcon name="imgPresenceIndicator" />{activeFans === null ? (offline ? 'Presence unavailable' : 'Connecting to the cosmos…') : `${activeFans} ${activeFans === 1 ? 'fan' : 'fans'} here now`}
        </span></div>
      <div className="community-media-filter"><div className="community-media-select"><CommunityIcon name="imgClapperboard" />
        <label className="sr-only" htmlFor="community-media">Filter by media</label>
        <select id="community-media" value={media} onChange={event => { setMedia(event.target.value); setOffset(0) }}>
          <option value="">All media</option>{mediaOptions.map(title => <option key={title} value={title}>{title}</option>)}
        </select><CommunityIcon name="imgChevronDown1" /></div>
        <div className="community-media-select"><CommunityIcon name="imgTag" /><label className="sr-only" htmlFor="community-tag">Filter by tag</label>
          <select id="community-tag" value={category} onChange={event => { setCategory(event.target.value as PostCategory | ''); setOffset(0) }}>
            <option value="">Any tag</option>{tabs.map(tab => <option key={tab.category} value={tab.category}>{tab.label}</option>)}
          </select><CommunityIcon name="imgTagChevron" />
        </div>
      </div>
      <div className="community-controls"><div className="community-search"><CommunityIcon name="imgSearch" /><label className="sr-only" htmlFor="community-query">Search conversations</label>
        <input id="community-query" type="search" placeholder="Search conversations..." value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setOffset(0) }} /></div>
        <div className="community-sort" aria-label="Sort conversations">{(['latest','popular'] as const).map(option => <button key={option} aria-pressed={sort === option} onClick={() => { setSort(option); setOffset(0) }}>{option === 'latest' ? 'Latest' : 'Popular'}</button>)}</div>
        <button className="community-primary" onClick={() => { setComposeError(''); setComposing(true) }}>Create post <span>✦</span></button>
      </div>
      <div className="community-feed-status"><span>{media || 'All conversations'}</span><div className="community-spoiler-control"><CommunityIcon name="imgShieldCheck" />
        <span id="spoiler-label">Show spoiler posts</span><button className={`community-toggle ${spoilers ? 'is-on' : ''}`} role="switch" aria-checked={spoilers} aria-labelledby="spoiler-label"
          onClick={() => { setSpoilers(value => !value); setOffset(0); setFeed(null); setSelected(null); setComments([]) }}>
          {spoilers ? <span /> : <CommunityIcon name="imgSpoilerToggleOff" />}</button><small>{spoilers ? 'On' : 'Off'}</small></div></div>
    </header>
    {offline && <div className="community-notice" role="status"><strong>Design preview</strong> · Community storage is unavailable. These are example posts; publishing and counts need the backend. <button onClick={() => setRevision(value => value + 1)}>Retry connection</button></div>}
    {error && <p className="community-alert" role="alert">{error}</p>}
    <p className="sr-only" aria-live="polite">{announcement}</p>
    <div className="community-workspace">
      <section id="community-feed" className="community-feed" aria-label="Conversations">
        {loading ? <div className="community-card community-empty" role="status">Finding your people…</div> : posts.length ? posts.map((post,index) => <article className="community-card post-card" key={post.id}>
          <div className="post-category"><CommunityIcon name={post.category === 'theory' ? 'imgSparkles' : post.category === 'review' ? 'imgStar10' : index === 1 ? 'imgMusic' : index === 2 ? 'imgCoffee' : 'imgMessagesSquare1'} />
            <strong>{post.category === 'discussion' ? 'Discussion' : post.category === 'theory' ? 'Theory' : 'Review'}</strong><CommunityIcon name="imgSeparator" /><span>{post.media}</span>
            {post.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}
            <button className="community-icon-button" aria-label={`Copy link to ${post.title}`} onClick={async () => {
              try { await navigator.clipboard.writeText(`${window.location.origin}/community?post=${post.id}`); setAnnouncement('Post link copied.') }
              catch { setError('Could not copy link. Open the post and copy its address.') }
            }}><CommunityIcon name="imgEllipsis" /></button>
          </div>
          <button className="post-open" onClick={() => { if (!offline) { setSelected(post); navigate(`/community?post=${post.id}`, {replace:true}) } else setError('Connect the Community backend to open example conversations.') }}><h2>{post.title}</h2></button>
          <p className="post-preview">{post.body}</p>{post.category === 'review' && post.rating && <p className="post-rating" aria-label={`${post.rating} out of 5 stars`}>{'★'.repeat(post.rating)}{'☆'.repeat(5-post.rating)}</p>}
          <div className="post-metadata"><span className="fan-avatar">{post.author.split(/\s+/).map(word => word[0]).slice(0,2).join('')}</span><strong>{post.author}</strong><span className="post-age">· {post.example ? 'Example post' : timeAgo(post.created_at)}</span>
            <button className="post-reaction" aria-label={`${post.liked ? 'Unlike' : 'Like'} ${post.title}`} aria-pressed={post.liked} disabled={busyLike === post.id || offline} onClick={() => void like(post)}><CommunityIcon name={post.liked ? 'imgHeart' : 'imgHeart1'} />{post.likes}</button>
            <button className="post-reaction" aria-label={`Read ${post.comments} comments on ${post.title}`} disabled={offline} onClick={() => setSelected(post)}><CommunityIcon name="imgMessageCircle" />{post.comments}</button>
          </div>
        </article>) : <div className="community-card community-empty"><LittleUniverse /><h2>No signals yet ✦</h2><p>{query || media ? 'Try a different search or media filter.' : `Start the first ${category || 'conversation'} in this corner of the universe.`}</p></div>}
        {!loading && !offline && <div className="community-pagination">{offset > 0 && <button onClick={() => setOffset(value => Math.max(0,value-20))}>Previous</button>}{feed?.has_more && <button onClick={() => setOffset(value => value+20)}>Next conversations</button>}</div>}
        <p className="community-reassurance"><CommunityIcon name="imgSparkles" />{spoilers ? 'Spoiler posts are visible. Explore with care.' : 'A spoiler-free little corner of the cosmos.'}</p>
      </section>
    </div>
    <button className="community-guidelines-link" onClick={() => setGuidelines(true)}>Community guidelines ↗</button>
    {composing && <CommunityModal title="Create a post" subtitle="Share a question, theory, or review with your fellow fans." onClose={() => setComposing(false)} className="community-compose-modal">
      <form className="community-compose-form" onSubmit={event => void publish(event)}>
        <div className="community-modal-scroll">
          <div className="community-field-pair">
            <label>Tag<select value={draft.category} onChange={event => setDraft(current => ({...current, category:event.target.value as PostCategory}))}>
              {tabs.map(tab => <option key={tab.category} value={tab.category}>{tab.label}</option>)}
            </select></label>
            <label>Media<input required maxLength={200} list="community-media-names" placeholder="Anime, movie, or game" value={draft.media} onChange={event => setDraft(current => ({...current,media:event.target.value}))} /></label>
          </div>
          <datalist id="community-media-names">{mediaOptions.map(title => <option key={title} value={title} />)}</datalist>
          <label>Title<input required maxLength={160} placeholder="Give your conversation a title" value={draft.title} onChange={event => setDraft(current => ({...current,title:event.target.value}))} /></label>
          <label>Your message<textarea required maxLength={5000} rows={6} placeholder="What’s on your mind?" value={draft.body} onChange={event => setDraft(current => ({...current,body:event.target.value}))} /></label>
          {draft.category === 'review' && <label>Rating<select value={draft.rating || ''} onChange={event => setDraft(current => ({...current,rating:event.target.value ? Number(event.target.value) : null}))}><option value="">No rating</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5 stars</option>)}</select></label>}
          {composeError && <p className="community-alert" role="alert">{composeError}</p>}
          {offline && <p className="community-alert">Publishing is unavailable while the Community backend is offline.</p>}
        </div>
        <footer className="community-compose-footer"><label className="community-checkbox"><input type="checkbox" checked={draft.contains_spoilers} onChange={event => setDraft(current => ({...current,contains_spoilers:event.target.checked}))} />Contains spoilers</label>
          {viewer ? <button className="community-primary" type="submit" disabled={sending || offline}>{sending ? 'Publishing…' : 'Publish post'} <span>✦</span></button> : <Link className="community-primary" to="/auth/sign-in">Sign in to publish</Link>}
        </footer>
      </form>
    </CommunityModal>}
    {selected && <CommunityModal title="Conversation" subtitle={`${selected.category === 'discussion' ? 'Discussion' : selected.category === 'theory' ? 'Theory' : 'Review'} · ${selected.media}`} onClose={closeConversation} className="community-conversation">
      <div className="community-modal-scroll" tabIndex={0} aria-label="Post and replies">
        <article className="conversation-post">
          <div className="conversation-byline"><span className="fan-avatar">{selected.author.split(/\s+/).map(word => word[0]).slice(0,2).join('')}</span><strong>{selected.author}</strong><time dateTime={selected.created_at}>{timeAgo(selected.created_at)}</time>{selected.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}</div>
          <h3>{selected.title}</h3><p className="conversation-body">{selected.body}</p>
          {selected.category === 'review' && selected.rating && <p className="post-rating" aria-label={`${selected.rating} out of 5 stars`}>{'★'.repeat(selected.rating)}{'☆'.repeat(5-selected.rating)}</p>}
          <button className="post-reaction" aria-label={`${selected.liked ? 'Unlike' : 'Like'} ${selected.title}`} aria-pressed={selected.liked} disabled={busyLike === selected.id} onClick={() => void like(selected)}><CommunityIcon name={selected.liked ? 'imgHeart' : 'imgHeart1'} />{selected.likes} {selected.likes === 1 ? 'like' : 'likes'}</button>
        </article>
        <section className="conversation-replies" aria-labelledby="conversation-replies-title" aria-busy={commentsLoading}>
          <div className="conversation-replies-heading"><h3 id="conversation-replies-title">Replies <span>{selected.comments}</span></h3><small>{spoilers ? 'Spoilers visible' : 'Spoiler replies hidden'}</small></div>
          {commentsLoading ? <p className="conversation-empty" role="status">Loading replies…</p> : comments.length ? <div className="conversation-comment-list">{comments.map(comment => <article className="conversation-comment" key={comment.id}>
            <span className="fan-avatar">{comment.author.split(/\s+/).map(word => word[0]).slice(0,2).join('')}</span>
            <div><div className="conversation-comment-meta"><strong>{comment.author}</strong><time dateTime={comment.created_at}>{timeAgo(comment.created_at)}</time>{comment.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}</div><p className="conversation-body">{comment.body}</p></div>
          </article>)}</div> : !dialogError && <p className="conversation-empty">No replies yet. Start the conversation.</p>}
        </section>
      </div>
      <form className="conversation-reply-form" onSubmit={event => void addComment(event)}>
        {dialogError && <p className="community-alert" role="alert">{dialogError}</p>}
        <div className="conversation-reply-label"><label htmlFor="comment-body">Your reply</label><small>{commentBody.length.toLocaleString()}/2,000</small></div>
        <textarea id="comment-body" required maxLength={2000} rows={3} placeholder={viewer ? 'Add something to the conversation…' : 'Sign in to join the conversation'} disabled={!viewer || commentSending} value={commentBody} onChange={event => setCommentBody(event.target.value)} />
        <div className="conversation-reply-actions"><label className="community-checkbox"><input type="checkbox" checked={commentSpoilers} disabled={!viewer || commentSending} onChange={event => setCommentSpoilers(event.target.checked)} />Contains spoilers</label>
          {viewer ? <button className="community-primary" disabled={commentSending || !commentBody.trim()}>{commentSending ? 'Posting…' : 'Post reply'} <span>↗</span></button> : <Link className="community-primary" to="/auth/sign-in">Sign in to reply</Link>}
        </div>
        <p className="conversation-reply-hint">Keep it kind. Mark plot revelations as spoilers.</p>
      </form>
    </CommunityModal>}
    {guidelines && <CommunityModal title="Community guidelines" subtitle="A welcoming space for every fan." onClose={() => setGuidelines(false)}>
      <div className="community-modal-scroll community-guidelines-copy"><p>Respect other fans. Mark plot revelations in posts and comments as spoilers. Keep titles spoiler-free where possible. Never share someone’s private information.</p><p>Spoiler labels are supplied by authors; they are not a guarantee that unmarked content is spoiler-free.</p></div>
    </CommunityModal>}
  </CommunityShell>
}
