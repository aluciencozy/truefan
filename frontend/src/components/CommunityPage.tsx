import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { communityApi, examplePosts, timeAgo, visitorId } from '../lib/community'
import type { CommunityComment, CommunityFeed, CommunityPost, PostCategory, PostCreate } from '../lib/community'
import CommunityShell, { CommunityIcon, LittleUniverse } from './CommunityShell'
import type { CommunityViewer } from './CommunityShell'

const tabs: { label: string; category: PostCategory }[] = [
  { label: 'Discussions', category: 'discussion' }, { label: 'Theories', category: 'theory' }, { label: 'Reviews', category: 'review' },
]
const blankPost = (): PostCreate => ({ category: 'discussion', media: '', title: '', body: '', contains_spoilers: false, rating: null })

function ConnectedCommunity() {
  const session = authClient!.useSession()
  return <CommunityScreen viewer={session.data?.user ? { name: session.data.user.name || 'Fan' } : null} />
}

export default function CommunityPage() { return authClient ? <ConnectedCommunity /> : <CommunityScreen viewer={null} /> }

function CommunityScreen({ viewer }: { viewer: CommunityViewer | null }) {
  const signedIn = Boolean(viewer)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const linkedPostId = searchParams.get('post')
  const [category, setCategory] = useState<PostCategory>('discussion')
  const [media, setMedia] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [spoilers, setSpoilers] = useState(false)
  const [feed, setFeed] = useState<CommunityFeed | null>(null)
  const [activeFans, setActiveFans] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
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
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const guidelineRef = useRef<HTMLDialogElement>(null)
  const [visitor] = useState(visitorId)
  const activeThread = useRef<string | null>(null)
  activeThread.current = selected?.id || null

  useEffect(() => {
    const controller = new AbortController()
    // Clear stale posts and dialogs immediately on a filter/spoiler change.
    setFeed(null); setSelected(null); setComments([]); setLoading(true); setError('')
    const timer = setTimeout(() => {
      communityApi.feed({ category, media, q: query.trim(), sort, spoilers, offset }, signedIn, controller.signal)
        .then(data => { if (!controller.signal.aborted) { setFeed(data); setActiveFans(data.active_fans); setOffline(false) } })
        .catch(() => {
          if (!controller.signal.aborted) { setOffline(true); setActiveFans(null); setError('') }
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [category, media, query, sort, spoilers, signedIn, revision, offset])

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function heartbeat() {
      if (document.visibilityState !== 'visible' || pending) return
      pending = true
      try { const data = await communityApi.presence(visitor, category, signedIn, controller.signal); if (!controller.signal.aborted) setActiveFans(data.active_fans) }
      catch { if (!controller.signal.aborted) setActiveFans(null) }
      finally { pending = false }
    }
    void heartbeat()
    const interval = setInterval(() => void heartbeat(), 25000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', heartbeat) }
  }, [visitor, category, signedIn])

  useEffect(() => {
    if (!linkedPostId) return
    const controller = new AbortController()
    communityApi.post(linkedPostId, spoilers, signedIn, controller.signal).then(post => {
      if (!controller.signal.aborted) setSelected(post)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [linkedPostId, spoilers, signedIn])

  useEffect(() => {
    if (selected) { dialogRef.current?.showModal() } else { dialogRef.current?.close() }
    if (!selected) return
    const controller = new AbortController()
    setComments([]); setDialogError(''); setCommentBody(''); setCommentSpoilers(false); setCommentsLoading(true)
    communityApi.comments(selected.id, spoilers, controller.signal).then(data => { if (!controller.signal.aborted) setComments(data) })
      .catch(error => { if (!controller.signal.aborted) setDialogError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setCommentsLoading(false) })
    return () => controller.abort()
  }, [selected?.id, spoilers])

  useEffect(() => { if (guidelines) guidelineRef.current?.showModal(); else guidelineRef.current?.close() }, [guidelines])

  function requireSignIn(): boolean {
    if (viewer) return true
    if (!authClient) { setError('Google sign-in is not configured yet. Ask your team to configure Neon Auth.'); return false }
    navigate('/auth/sign-in'); return false
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!requireSignIn() || offline || sending) return
    setSending(true); setError(''); setAnnouncement('')
    try {
      await communityApi.create(draft)
      setCategory(draft.category); setMedia(''); setQuery(''); setOffset(0); setSort('latest')
      if (draft.contains_spoilers) setSpoilers(true)
      setDraft({ ...blankPost(), category: draft.category }); setRevision(value => value + 1); setAnnouncement('Your post was published.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not publish post') }
    finally { setSending(false) }
  }

  async function like(post: CommunityPost) {
    if (!requireSignIn() || offline || busyLike) return
    setBusyLike(post.id); setError('')
    try {
      const updated = await communityApi.like(post.id, !post.liked, spoilers)
      setFeed(current => current ? { ...current, posts: current.posts.map(item => item.id === post.id ? updated : item) } : current)
      setSelected(current => current?.id === updated.id ? updated : current)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update like') }
    finally { setBusyLike(null) }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault()
    if (!selected || !requireSignIn() || commentSending) return
    setCommentSending(true); setDialogError('')
    const threadId = selected.id
    try {
      const comment = await communityApi.comment(selected.id, commentBody, commentSpoilers, spoilers)
      if (activeThread.current !== threadId) return
      if (!comment.contains_spoilers || spoilers) {
        setComments(current => [...current, comment]); setSelected(current => current ? { ...current, comments: current.comments + 1 } : current)
        setFeed(current => current ? { ...current, posts: current.posts.map(post => post.id === selected.id ? { ...post, comments: post.comments + 1 } : post) } : current)
      }
      setCommentBody(''); setCommentSpoilers(false)
      setAnnouncement(comment.contains_spoilers && !spoilers ? 'Spoiler comment saved. Enable Show spoiler posts to see it.' : 'Comment posted.')
    } catch (error) { setDialogError(error instanceof Error ? error.message : 'Could not post comment') }
    finally { setCommentSending(false) }
  }

  const previewPosts = examplePosts.filter(post => post.category === category && (!media || post.media === media)
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
        </select><CommunityIcon name="imgChevronDown1" /></div><span>Find your corner of the universe</span></div>
      <div className="community-tabs" role="tablist" aria-label="Post categories">{tabs.map(tab =>
        <button id={`tab-${tab.category}`} key={tab.category} role="tab" aria-selected={category === tab.category} aria-controls="community-feed"
          onClick={() => { setCategory(tab.category); setDraft(current => ({ ...current, category: tab.category })); setOffset(0) }}>{tab.label}</button>)}</div>
      <div className="community-controls"><div className="community-search"><CommunityIcon name="imgSearch" /><label className="sr-only" htmlFor="community-query">Search conversations</label>
        <input id="community-query" type="search" placeholder="Search conversations..." value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setOffset(0) }} /></div>
        <div className="community-sort" aria-label="Sort conversations">{(['latest','popular'] as const).map(option => <button key={option} aria-pressed={sort === option} onClick={() => { setSort(option); setOffset(0) }}>{option === 'latest' ? 'Latest' : 'Popular'}</button>)}</div>
        <button className="community-primary" onClick={() => { titleRef.current?.scrollIntoView({behavior:'smooth',block:'center'}); titleRef.current?.focus() }}>Create post <span>✦</span></button>
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
      <section id="community-feed" className="community-feed" role="tabpanel" aria-labelledby={`tab-${category}`}>
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
        </article>) : <div className="community-card community-empty"><LittleUniverse /><h2>No signals yet ✦</h2><p>{query || media ? 'Try a different search or media filter.' : `Start the first ${category} in this corner of the universe.`}</p></div>}
        {!loading && !offline && <div className="community-pagination">{offset > 0 && <button onClick={() => setOffset(value => Math.max(0,value-20))}>Previous</button>}{feed?.has_more && <button onClick={() => setOffset(value => value+20)}>Next conversations</button>}</div>}
        <p className="community-reassurance"><CommunityIcon name="imgSparkles" />{spoilers ? 'Spoiler posts are visible. Explore with care.' : 'A spoiler-free little corner of the cosmos.'}</p>
      </section>
      <aside className="community-companion">
        <form className="community-card community-composer" onSubmit={event => void publish(event)}>
          <div><h2>Send a little signal ✦</h2><p>A question, a thought, a new obsession. There’s a fan for that.</p></div>
          <div className="composer-category"><CommunityIcon name="imgMessagesSquare2" /><label className="sr-only" htmlFor="post-category">Post category</label>
            <select id="post-category" value={draft.category} onChange={event => setDraft(current => ({...current,category:event.target.value as PostCategory}))}>{tabs.map(tab => <option key={tab.category} value={tab.category}>{tab.category === 'discussion' ? 'Discussion' : tab.category === 'theory' ? 'Theory' : 'Review'}</option>)}</select><CommunityIcon name="imgChevronDown" /></div>
          <label className="sr-only" htmlFor="post-title">Post title</label><input id="post-title" ref={titleRef} required maxLength={160} placeholder="Give your post a title" value={draft.title} onChange={event => setDraft(current => ({...current,title:event.target.value}))} />
          <label className="sr-only" htmlFor="post-body">Your message</label><textarea id="post-body" required maxLength={5000} placeholder="What’s on your mind?" value={draft.body} onChange={event => setDraft(current => ({...current,body:event.target.value}))} />
          {(draft.title || draft.body) && <div><label className="sr-only" htmlFor="post-media">Show, movie or game</label><input id="post-media" required maxLength={200} list="community-media-names" placeholder="Show, movie or game" value={draft.media} onChange={event => setDraft(current => ({...current,media:event.target.value}))} /><datalist id="community-media-names">{mediaOptions.map(title => <option key={title} value={title} />)}</datalist></div>}
          {draft.category === 'review' && <label>Rating<select value={draft.rating || ''} onChange={event => setDraft(current => ({...current,rating:event.target.value ? Number(event.target.value) : null}))}><option value="">No rating</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5 stars</option>)}</select></label>}
          <label className="community-checkbox"><input type="checkbox" checked={draft.contains_spoilers} onChange={event => setDraft(current => ({...current,contains_spoilers:event.target.checked}))} />Contains spoilers</label>
          <button className="community-primary" type="submit" disabled={sending || offline}>{sending ? 'Sending…' : 'Create post'} <span>✦</span></button>
          {!viewer && <Link className="composer-signin" to="/auth/sign-in">Sign in to publish, like, and comment</Link>}
        </form>
        <section className="community-card community-guidelines"><h2><CommunityIcon name="imgSparkles1" />Keep the magic alive</h2><ul><li>Be kind. Every fan belongs.</li><li>Tag spoilers. Save the surprise.</li><li>Disagree without the drama.</li></ul><button onClick={() => setGuidelines(true)}>Community guidelines ↗</button></section>
      </aside>
    </div>
    <dialog ref={dialogRef} className="community-dialog" onCancel={() => setSelected(null)} onClose={() => { setSelected(null); navigate('/community',{replace:true}) }}>
      {selected && <><button className="dialog-close" onClick={() => setSelected(null)} aria-label="Close conversation">×</button><span className="tag">{selected.category} · {selected.media}</span><h2>{selected.title}</h2><p className="post-full-body">{selected.body}</p><small>By {selected.author}</small>
        <button className="post-reaction" aria-pressed={selected.liked} disabled={busyLike === selected.id} onClick={() => void like(selected)}><CommunityIcon name={selected.liked ? 'imgHeart' : 'imgHeart1'} />{selected.likes} likes</button>
        <h3>Comments</h3>{commentsLoading ? <p role="status">Loading comments…</p> : comments.length ? comments.map(comment => <article className="community-comment" key={comment.id}><strong>{comment.author}</strong><small>{timeAgo(comment.created_at)}</small>{comment.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}<p>{comment.body}</p></article>) : <p>Be the first to reply.</p>}
        {dialogError && <p role="alert">{dialogError}</p>}
        <form onSubmit={event => void addComment(event)}><label htmlFor="comment-body">Send a reply</label><textarea id="comment-body" required maxLength={2000} value={commentBody} onChange={event => setCommentBody(event.target.value)} /><label className="community-checkbox"><input type="checkbox" checked={commentSpoilers} onChange={event => setCommentSpoilers(event.target.checked)} />Contains spoilers</label><button className="community-primary" disabled={commentSending}>{commentSending ? 'Sending…' : 'Post comment'}</button></form>
      </>}
    </dialog>
    <dialog ref={guidelineRef} className="community-dialog" onCancel={() => setGuidelines(false)} onClose={() => setGuidelines(false)}><button className="dialog-close" aria-label="Close guidelines" onClick={() => setGuidelines(false)}>×</button><h2>Keep the magic alive ✦</h2><p>Respect other fans. Mark any plot revelations in both posts and comments as spoilers. Keep titles spoiler-free where possible. Never share someone’s private information.</p><p>Spoiler labels are supplied by authors; they are not a guarantee that unmarked content is spoiler-free.</p></dialog>
  </CommunityShell>
}
