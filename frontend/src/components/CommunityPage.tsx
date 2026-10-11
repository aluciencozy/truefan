import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { usePageReady } from '../lib/pageTransition'
import { communityApi, timeAgo, visitorId, forumRooms } from '../lib/community'
import type { CommunityComment, CommunityFeed, CommunityPost, PostCategory, PostCreate, RoomId } from '../lib/community'
import CommunityShell, { CommunityIcon, LittleUniverse } from './CommunityShell'
import type { CommunityViewer } from './CommunityShell'
import CommunityModal from './CommunityModal'
import ForumParticipation from './ForumParticipation'
import CommentThread from './CommentThread'
import CommunityAttachment from './CommunityAttachment'
import './CommunityPage.css'

const tabs: { label: string; category: PostCategory }[] = [
  { label: 'Discussions', category: 'discussion' }, { label: 'Theories', category: 'theory' }, { label: 'Reviews', category: 'review' },
]
const blankPost = (): PostCreate => ({ category: 'discussion', media: '', title: '', body: '', contains_spoilers: false, rating: null, room:null, side_a:'Prosecution',side_b:'Defense',target_episode:1 })

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
  const [category, setCategory] = useState<PostCategory | ''>('discussion')
  const [room, setRoom] = useState<RoomId | ''>('')
  const [editingPost, setEditingPost] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<CommunityComment | null>(null)
  const commentInput = useRef<HTMLTextAreaElement>(null)
  const commentsSection = useRef<HTMLElement>(null)
  const openComments = useRef(false)
  const [editingComment, setEditingComment] = useState<string | null>(null)
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
  const [commentImage, setCommentImage] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
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
  const threadBack = useRef<HTMLButtonElement>(null)
  activeThread.current = selected?.id || null

  useEffect(() => {
    if (selected?.room) {
      threadBack.current?.focus?.({ preventScroll: true })
      threadBack.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [selected?.id])

  useEffect(() => {
    const controller = new AbortController()
    // Clear stale posts and dialogs immediately on a filter/spoiler change.
    setFeed(null); setSelected(null); setComments([]); setLoading(true); setError('')
    const timer = setTimeout(() => {
      service.feed({ category, room, media, q: query.trim(), sort, spoilers, offset }, signedIn, controller.signal)
        .then(data => { if (!controller.signal.aborted) { setFeed(data); setActiveFans(data.active_fans); setOffline(false) } })
        .catch(() => {
          if (!controller.signal.aborted) { setOffline(true); setActiveFans(null); setError('') }
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [category, room, media, query, sort, spoilers, signedIn, revision, offset, service])

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
    setComments([]); setReplyingTo(null); setEditingComment(null); setCommentSending(false); setDialogError(''); setCommentBody(''); setCommentImage(''); setImageBusy(false); setCommentSpoilers(false); setCommentsLoading(true)
    service.comments(selected.id, spoilers, controller.signal, signedIn).then(data => { if (!controller.signal.aborted) setComments(data) })
      .catch(error => { if (!controller.signal.aborted) setDialogError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setCommentsLoading(false) })
    return () => controller.abort()
  }, [selected?.id, spoilers, service])

  useEffect(() => {
    if (selected && !commentsLoading && openComments.current) {
      commentsSection.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      openComments.current = false
    }
  }, [selected?.id, commentsLoading])

  function abandonPost() { setImageBusy(false); setComposing(false); setEditingPost(null); setDraft(blankPost()); setComposeError('') }
  function cancelComment() { setEditingComment(null); setReplyingTo(null); setCommentBody(''); setCommentImage(''); setCommentSpoilers(false) }
  async function refreshConversation(id: string) {
    const [items, post] = await Promise.all([service.comments(id, spoilers, undefined, signedIn), service.post(id, spoilers, signedIn)])
    if (activeThread.current !== id) return
    setComments(items); setSelected(post)
    setFeed(current => current ? { ...current, posts: current.posts.map(item => item.id === id ? post : item) } : current)
  }
  function closeConversation() { setSelected(null); navigate('/community', { replace: true }) }

  function requireSignIn(): boolean {
    if (viewer) return true
    if (!authClient) { setError('Google sign-in is not configured yet. Ask your team to configure Neon Auth.'); return false }
    navigate('/auth/sign-in'); return false
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!requireSignIn() || offline || sending || imageBusy) return
    setSending(true); setComposeError(''); setAnnouncement('')
    try {
      if (editingPost) await service.update(editingPost,draft); else await service.create(draft)
      setEditingPost(null); closeConversation(); setRoom(draft.room || '')
      setCategory(draft.category); setMedia(''); setQuery(''); setOffset(0); setSort('latest')
      if (draft.contains_spoilers) setSpoilers(true)
      setDraft({ ...blankPost(), category: draft.category }); setRevision(value => value + 1); setAnnouncement(editingPost ? 'Your changes were saved.' : 'Your post was published.'); setComposing(false)
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
    if (!selected || (!commentBody.trim() && !commentImage) || !requireSignIn() || commentSending || imageBusy) return
    setCommentSending(true); setDialogError('')
    const threadId = selected.id
    try {
      const comment = editingComment ? await service.editComment(editingComment, commentBody, commentSpoilers, commentImage) : await service.comment(selected.id, commentBody, commentSpoilers, spoilers, replyingTo?.entry_id === replyingTo?.id ? null : replyingTo?.id || null, commentImage, replyingTo?.entry_id === replyingTo?.id ? replyingTo?.entry_id || null : null)
      if (activeThread.current !== threadId) return
      // Refresh from the server so changed spoiler flags also remove hidden descendants.
      if (editingComment && commentSpoilers) setComments([])
      cancelComment(); await refreshConversation(threadId)
      setAnnouncement(comment.contains_spoilers && !spoilers ? 'Spoiler comment saved. Enable Show spoiler posts to see it.' : 'Comment posted.')
    } catch (error) { if (activeThread.current === threadId) setDialogError(error instanceof Error ? error.message : 'Could not post comment') }
    finally { if (activeThread.current === threadId) setCommentSending(false) }
  }

  const posts = feed?.posts || []
  const mediaOptions = feed?.media || (media ? [media] : [])

  const currentRoom = forumRooms.find(item=>item.id===room)
  function startTopic(id:RoomId) {
    const selectedRoom=forumRooms.find(item=>item.id===id)!
    setDraft({...blankPost(),category:selectedRoom.category,room:id})
    setEditingPost(null);setComposeError('');setComposing(true)
  }
  async function removePost(post:CommunityPost) {
    if (!window.confirm('Delete your topic and its contributions?')) return
    try {await service.remove(post.id);closeConversation();setRevision(v=>v+1);setAnnouncement('Topic deleted.')} catch(e) {setDialogError(e instanceof Error?e.message:'Could not delete topic')}
  }
  async function removeComment(comment:CommunityComment) {
    if (!window.confirm('Delete your reply?')) return
    if (!selected || commentSending) return
    const id = selected.id
    setCommentSending(true)
    try { await service.removeComment(comment.id); if (activeThread.current === id) { cancelComment(); await refreshConversation(id); setAnnouncement('Comment deleted. Replies remain in the conversation.') } }
    catch(e) { if (activeThread.current === id) setDialogError(e instanceof Error ? e.message : 'Could not delete reply') }
    finally { if (activeThread.current === id) setCommentSending(false) }
  }
  function replyTo(comment: CommunityComment) {
    if (!requireSignIn()) return
    setEditingComment(null); setReplyingTo(comment); setCommentBody(''); setCommentImage(''); setCommentSpoilers(comment.contains_spoilers)
  }
  useEffect(() => {
    if (replyingTo || editingComment) { commentInput.current?.focus(); commentInput.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'}) }
  }, [replyingTo, editingComment])
  const commentComposer = <form className="conversation-reply-form" onSubmit={event => void addComment(event)}>
        {dialogError && <p className="community-alert" role="alert">{dialogError}</p>}
        <div className="conversation-reply-label"><label htmlFor="comment-body">{editingComment ? 'Edit your comment' : replyingTo ? `Reply to @${replyingTo.author}` : 'Your comment'}</label><small>{commentBody.length.toLocaleString()}/2,000</small></div>
        <textarea ref={commentInput} id="comment-body" required={!commentImage} maxLength={2000} rows={3} placeholder={viewer ? 'Add something to the conversation…' : 'Sign in to join the conversation'} disabled={!viewer || commentSending} value={commentBody} onChange={event => setCommentBody(event.target.value)} />
        <CommunityAttachment value={commentImage} disabled={!viewer || commentSending} onChange={setCommentImage} onError={setDialogError} onBusyChange={setImageBusy}/><div className="conversation-reply-actions">{viewer && <button type="button" disabled={commentSending || imageBusy} onClick={cancelComment}>Cancel / abandon</button>}<label className="community-checkbox"><input type="checkbox" checked={commentSpoilers} disabled={!viewer || commentSending} onChange={event => setCommentSpoilers(event.target.checked)} />Contains spoilers</label>
          {viewer ? <button className="community-primary" disabled={commentSending || imageBusy || (!commentBody.trim() && !commentImage)}>{commentSending ? 'Posting…' : editingComment ? 'Save changes' : replyingTo ? 'Post reply' : 'Post comment'} <span>↗</span></button> : <Link className="community-primary" to="/auth/sign-in">Sign in to reply</Link>}
        </div>
        <p className="conversation-reply-hint">Keep it kind. Mark plot revelations as spoilers.</p>
      </form>
  const activeCommentId = editingComment || replyingTo?.id
  const conversation = selected && <>
      <div className="community-modal-scroll" tabIndex={0} aria-label="Post and replies">
        <article className="conversation-post">
          <div className="conversation-byline"><span className="fan-avatar">{selected.author.split(/\s+/).map(word => word[0]).slice(0,2).join('')}</span><strong>{selected.author}</strong><time dateTime={selected.created_at}>{timeAgo(selected.created_at)}</time>{selected.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}</div>
          {selected.is_owner&&<div className="forum-entry-actions"><button onClick={()=>{setEditingPost(selected.id);setDraft({category:selected.category,room:selected.room,media:selected.media,title:selected.title,body:selected.body,contains_spoilers:selected.contains_spoilers,rating:selected.rating,side_a:selected.side_a,side_b:selected.side_b,target_episode:selected.target_episode,image:selected.image || ''});setSelected(null);setComposing(true)}}>Edit topic</button><button onClick={()=>void removePost(selected)}>Delete topic</button></div>}
          <h3>{selected.title}</h3>{selected.image && <img className="community-post-image" src={selected.image} alt="Image attached to this post"/>}<p className="conversation-body">{selected.body}</p>
          {selected.category === 'review' && selected.rating && <p className="post-rating" aria-label={`${selected.rating} out of 5 stars`}>{'★'.repeat(selected.rating)}{'☆'.repeat(5-selected.rating)}</p>}
          <button className="post-reaction" aria-label={`${selected.liked ? 'Unlike' : 'Like'} ${selected.title}`} aria-pressed={selected.liked} disabled={busyLike === selected.id} onClick={() => void like(selected)}><CommunityIcon name={selected.liked ? 'imgHeart' : 'imgHeart1'} />{selected.likes} {selected.likes === 1 ? 'like' : 'likes'}</button>
        </article>
        {selected.room&&<ForumParticipation key={`${selected.id}:${spoilers}`} post={selected} signedIn={signedIn} spoilers={spoilers} service={service} comments={comments} onReply={replyTo} onEditComment={comment => {setReplyingTo(null);setEditingComment(comment.id);setCommentBody(comment.body);setCommentImage(comment.image || '');setCommentSpoilers(comment.contains_spoilers)}} onDeleteComment={comment => void removeComment(comment)} activeCommentId={activeCommentId} composer={commentComposer} commentBusy={commentSending}/>}
        {(!selected.room || comments.some(comment => !comment.entry_id && !comment.parent_id)) && <section ref={commentsSection} className="conversation-replies" aria-labelledby="conversation-replies-title" aria-busy={commentsLoading}>
          <div className="conversation-replies-heading"><h3 id="conversation-replies-title">Replies <span>{selected.comments}</span></h3><small>{spoilers ? 'Spoilers visible' : 'Spoiler replies hidden'}</small></div>
          {commentsLoading ? <p className="conversation-empty" role="status">Loading replies…</p> : comments.length ? <div className="conversation-comment-list">{comments.filter(comment => !comment.entry_id && (!comment.parent_id || !comments.some(parent => parent.id === comment.parent_id))).map(root => <CommentThread key={root.id} root={root} comments={comments} busy={commentSending} signedIn={signedIn}
            activeCommentId={activeCommentId} composer={commentComposer} onReply={replyTo}
            onEdit={comment => { setReplyingTo(null); setEditingComment(comment.id); setCommentBody(comment.body); setCommentImage(comment.image || ''); setCommentSpoilers(comment.contains_spoilers); commentInput.current?.focus(); commentInput.current?.scrollIntoView?.({block:'center',behavior:'smooth'}) }}
            onDelete={comment => void removeComment(comment)} />)}</div> : !dialogError && <p className="conversation-empty">No replies yet. Start the conversation.</p>}
        </section>}
      </div>
      {!activeCommentId && commentComposer}
  </>
  return <CommunityShell>
    <header className="community-header">
      <div className="community-introduction"><div><h1>Community ✦</h1><p>Talk, create, investigate, and find your next favorite story.</p></div>
        <span className="community-presence" title="Visitors active within the last 90 seconds; signed-in users are deduplicated across browsers.">
          <CommunityIcon name="imgPresenceIndicator" />{activeFans === null ? (offline ? 'Presence unavailable' : 'Connecting to the cosmos…') : `${activeFans} ${activeFans === 1 ? 'fan' : 'fans'} here now`}
        </span></div>
    </header>
    {offline && <div className="community-notice" role="status"><strong>Community unavailable</strong> · Could not load posts. Retry to reconnect. <button onClick={() => setRevision(value => value + 1)}>Retry connection</button></div>}
    {error && <p className="community-alert" role="alert">{error}</p>}
    <p className="sr-only" aria-live="polite">{announcement}</p>
    <nav className="forum-tabs" aria-label="Forum categories">{tabs.map(tab=><button key={tab.category} aria-pressed={(selected?.category||category||'discussion')===tab.category} onClick={()=>{closeConversation();setCategory(tab.category);setRoom('');setOffset(0)}}>{tab.label}</button>)}</nav>
    <div className="community-workspace forum-workspace">
      <aside className="forum-rooms" aria-label="Forum rooms"><h2>Rooms</h2><button aria-pressed={!(selected?.room||room)} onClick={()=>{if(selected)setCategory(selected.category);closeConversation();setRoom('');setOffset(0)}}>All conversations</button>
        {forumRooms.filter(item=>item.category===(selected?.category||category||'discussion')).map(item=><div className="forum-room-option" key={item.id}><button title={item.description} aria-pressed={(selected?.room||room)===item.id} onClick={()=>{closeConversation();setRoom(item.id);setCategory(item.category);setOffset(0)}}>{item.name}</button><details className="room-explanation"><summary aria-label={`About ${item.name}`} title={item.description}>ⓘ About this room</summary><p>{item.description}</p></details></div>)}
        <details className="spoiler-shield-notes"><summary title="Keep references within what you have watched and mark plot details as spoilers.">✦ Spoiler shield ▾</summary><p>Keep topics and references within what you have watched. Mark plot details as spoilers. Labels are supplied by authors and cannot guarantee spoiler safety.</p></details>
      </aside>
      <section id="community-feed" className="community-feed" aria-label="Conversations">
        {selected?.room ? <section className="forum-thread" aria-label={`${selected.title} conversation`}>
          <button ref={threadBack} className="forum-back" onClick={()=>{setCategory(selected.category);setRoom('');setOffset(0);closeConversation()}}>← All {selected.category === 'theory' ? 'theories' : selected.category === 'review' ? 'reviews' : 'discussions'}</button>
          <p className="forum-thread-room">{forumRooms.find(item => item.id === selected.room)?.name} / {selected.media}</p>
          {conversation}
        </section> : <>

        <div className="forum-room-heading"><div><h2>{currentRoom?.name || (category === 'theory' ? 'Theory rooms' : category === 'review' ? 'Review rooms' : 'Discussion rooms')}</h2>{currentRoom&&<p>{currentRoom.description}</p>}</div>{currentRoom&&<button className="community-primary" onClick={()=>startTopic(currentRoom.id)}>Start a topic</button>}</div>
<div className="forum-feed-toolbar">      <div className="community-media-filter"><div className="community-media-select"><CommunityIcon name="imgClapperboard" />
        <label className="sr-only" htmlFor="community-media">Filter by media</label>
        <select id="community-media" value={media} onChange={event => { setMedia(event.target.value); setOffset(0) }}>
          <option value="">All media</option>{mediaOptions.map(title => <option key={title} value={title}>{title}</option>)}
        </select><CommunityIcon name="imgChevronDown1" /></div>
      </div>
      <div className="community-controls"><div className="community-search"><CommunityIcon name="imgSearch" /><label className="sr-only" htmlFor="community-query">Search conversations</label>
        <input id="community-query" type="search" placeholder="Search conversations..." value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setOffset(0) }} /></div>
        <div className="community-sort" aria-label="Sort conversations">{(['latest','popular'] as const).map(option => <button key={option} aria-pressed={sort === option} onClick={() => { setSort(option); setOffset(0) }}>{option === 'latest' ? 'Latest' : 'Popular'}</button>)}</div>
        <button className="community-primary" onClick={() => { setDraft({...blankPost(),category:category||'discussion',room:room||null});setEditingPost(null);setComposeError(''); setComposing(true) }}>Create post <span>✦</span></button>
      </div>
</div>      <div className="community-feed-status"><span>{media || 'All conversations'}</span><div className="community-spoiler-control"><CommunityIcon name="imgShieldCheck" />
        <span id="spoiler-label">Show spoiler posts</span><button className={`community-toggle ${spoilers ? 'is-on' : ''}`} role="switch" aria-checked={spoilers} aria-labelledby="spoiler-label"
          onClick={() => { setSpoilers(value => !value); setOffset(0); setFeed(null); setSelected(null); setComments([]) }}>
          {spoilers ? <span /> : <CommunityIcon name="imgSpoilerToggleOff" />}</button><small>{spoilers ? 'On' : 'Off'}</small></div></div>


        {loading ? <div className="community-card community-empty" role="status">Finding your people…</div> : posts.length ? posts.map((post,index) => <article className="community-card post-card" key={post.id}>
          <div className="post-category"><CommunityIcon name={post.category === 'theory' ? 'imgSparkles' : post.category === 'review' ? 'imgStar10' : index === 1 ? 'imgMusic' : index === 2 ? 'imgCoffee' : 'imgMessagesSquare1'} />
            <strong>{forumRooms.find(item=>item.id===post.room)?.name || (post.category === 'discussion' ? 'Discussion' : post.category === 'theory' ? 'Theory' : 'Review')}</strong><CommunityIcon name="imgSeparator" /><span>{post.media}</span>
            {post.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}
            <button className="community-icon-button" aria-label={`Copy link to ${post.title}`} onClick={async () => {
              try { await navigator.clipboard.writeText(`${window.location.origin}/community?post=${post.id}`); setAnnouncement('Post link copied.') }
              catch { setError('Could not copy link. Open the post and copy its address.') }
            }}><CommunityIcon name="imgEllipsis" /></button>
          </div>
          <button className="post-open" onClick={() => { if (!offline) { setSelected(post); navigate(`/community?post=${post.id}`, {replace:true}) } }}><h2>{post.title}</h2></button>
          {post.image && <img className="community-post-image" src={post.image} alt="Image attached to this post"/>}<p className="post-preview">{post.body}</p>{post.category === 'review' && post.rating && <p className="post-rating" aria-label={`${post.rating} out of 5 stars`}>{'★'.repeat(post.rating)}{'☆'.repeat(5-post.rating)}</p>}
          <div className="post-metadata"><span className="fan-avatar">{post.author.split(/\s+/).map(word => word[0]).slice(0,2).join('')}</span><strong>{post.author}</strong><span className="post-age">· {timeAgo(post.created_at)}</span>
            <button className="post-reaction" aria-label={`${post.liked ? 'Unlike' : 'Like'} ${post.title}`} aria-pressed={post.liked} disabled={busyLike === post.id || offline} onClick={() => void like(post)}><CommunityIcon name={post.liked ? 'imgHeart' : 'imgHeart1'} />{post.likes}</button>
            <button className="post-reaction" aria-label={`Read ${post.comments} comments on ${post.title}`} disabled={offline} onClick={() => { openComments.current = true; setSelected(post); navigate(`/community?post=${post.id}`, {replace:true}) }}><CommunityIcon name="imgMessageCircle" />{post.comments}</button>
          </div>
        </article>) : !offline ? <div className="community-card community-empty"><LittleUniverse /><h2>No signals yet ✦</h2><p>{query || media ? 'Try a different search or media filter.' : `Start the first ${category || 'conversation'} in this corner of the universe.`}</p></div> : null}
        {!loading && !offline && <div className="community-pagination">{offset > 0 && <button onClick={() => setOffset(value => Math.max(0,value-20))}>Previous</button>}{feed?.has_more && <button onClick={() => setOffset(value => value+20)}>Next conversations</button>}</div>}
        <p className="community-reassurance"><CommunityIcon name="imgSparkles" />{spoilers ? 'Spoiler posts are visible. Explore with care.' : 'A spoiler-free little corner of the cosmos.'}</p>
        </>}
      </section>
    </div>
    <button className="community-guidelines-link" onClick={() => setGuidelines(true)}>Community guidelines ↗</button>
    {composing && <CommunityModal title={editingPost ? 'Edit your topic' : 'Create a post'} subtitle="Share a question, theory, or review with your fellow fans." onClose={abandonPost} className="community-compose-modal">
      <form className="community-compose-form" onSubmit={event => void publish(event)}>
        <div className="community-modal-scroll">
          <div className="community-field-pair">
            <label>Tag<select value={draft.category} onChange={event => setDraft(current => ({...current, category:event.target.value as PostCategory,room:null}))}>
              {tabs.map(tab => <option key={tab.category} value={tab.category}>{tab.label}</option>)}
            </select></label>
            <label>Media<input required maxLength={200} list="community-media-names" placeholder="Anime, movie, or game" value={draft.media} onChange={event => setDraft(current => ({...current,media:event.target.value}))} /></label>
          </div>
          <label>Room<select value={draft.room||''} onChange={event=>setDraft(current=>({...current,room:event.target.value as RoomId||null}))}><option value="">General conversation</option>{forumRooms.filter(item=>item.category===draft.category).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {(draft.room==='courtroom'||draft.room==='battle'||draft.room==='hot-take')&&<div className="community-field-pair"><label>First side<input required maxLength={80} value={draft.side_a||''} onChange={e=>setDraft(d=>({...d,side_a:e.target.value}))}/></label><label>Second side<input required maxLength={80} value={draft.side_b||''} onChange={e=>setDraft(d=>({...d,side_b:e.target.value}))}/></label></div>}
          {draft.room==='capsule'&&<label>Episode to predict<input type="number" required min={1} max={10000} value={draft.target_episode||1} onChange={e=>setDraft(d=>({...d,target_episode:Number(e.target.value)}))}/></label>}
          <datalist id="community-media-names">{mediaOptions.map(title => <option key={title} value={title} />)}</datalist>
          <label>Title<input required maxLength={160} placeholder="Give your conversation a title" value={draft.title} onChange={event => setDraft(current => ({...current,title:event.target.value}))} /></label>
          <label>Your message<textarea required maxLength={5000} rows={6} placeholder="What’s on your mind?" value={draft.body} onChange={event => setDraft(current => ({...current,body:event.target.value}))} /></label>
          <CommunityAttachment value={draft.image || ''} disabled={sending} onChange={image=>setDraft(current=>({...current,image}))} onError={setComposeError} onBusyChange={setImageBusy}/>
          {draft.category === 'review' && <label>Rating<select value={draft.rating || ''} onChange={event => setDraft(current => ({...current,rating:event.target.value ? Number(event.target.value) : null}))}><option value="">No rating</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5 stars</option>)}</select></label>}
          {composeError && <p className="community-alert" role="alert">{composeError}</p>}
          {offline && <p className="community-alert">Publishing is unavailable while the Community backend is offline.</p>}
        </div>
        <footer className="community-compose-footer"><button type="button" disabled={sending} onClick={abandonPost}>Cancel / abandon</button><label className="community-checkbox"><input type="checkbox" checked={draft.contains_spoilers} onChange={event => setDraft(current => ({...current,contains_spoilers:event.target.checked}))} />Contains spoilers</label>
          {viewer ? <button className="community-primary" type="submit" disabled={sending || offline || imageBusy}>{sending ? 'Publishing…' : editingPost ? 'Save changes' : 'Publish post'} <span>✦</span></button> : <Link className="community-primary" to="/auth/sign-in">Sign in to publish</Link>}
        </footer>
      </form>
    </CommunityModal>}
    {selected && !selected.room && <CommunityModal title="Conversation" subtitle={`${selected.category === 'discussion' ? 'Discussion' : selected.category === 'theory' ? 'Theory' : 'Review'} · ${selected.media}`} onClose={closeConversation} className="community-conversation">
      {conversation}
    </CommunityModal>}
    {guidelines && <CommunityModal title="Community guidelines" subtitle="A welcoming space for every fan." onClose={() => setGuidelines(false)}>
      <div className="community-modal-scroll community-guidelines-copy"><p>Respect other fans. Mark plot revelations in posts and comments as spoilers. Keep titles spoiler-free where possible. Never share someone’s private information.</p><p>Spoiler labels are supplied by authors; they are not a guarantee that unmarked content is spoiler-free.</p></div>
    </CommunityModal>}
  </CommunityShell>
}
