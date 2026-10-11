import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CommunityComment } from '../lib/community'
import { timeAgo } from '../lib/community'

interface Props {
  root: CommunityComment
  comments: CommunityComment[]
  busy: boolean
  signedIn: boolean
  activeCommentId?: string | null
  composer?: ReactNode
  children?: ReactNode
  allowReply?: boolean
  onReply: (comment: CommunityComment) => void
  onEdit: (comment: CommunityComment) => void
  onDelete: (comment: CommunityComment) => void
}
export default function CommentThread({ root, comments, busy, signedIn, activeCommentId, composer, children, allowReply = true, onReply, onEdit, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  function descendants(id: string, visited = new Set<string>()): CommunityComment[] {
    if (visited.has(id)) return []
    visited.add(id)
    return comments.filter(c => c.parent_id === id || (id === root.id && c.entry_id === root.id && !c.parent_id)).flatMap(c => [c, ...descendants(c.id, visited)])
  }
  const replies = descendants(root.id)
  const activeReply = replies.some(c => c.id === activeCommentId)
  const showReplies = expanded || activeReply
  useEffect(() => { if (activeReply) setExpanded(true) }, [activeReply])
  function render(comment: CommunityComment) {
    const deadline = Date.parse(comment.editable_until || comment.created_at) + (comment.editable_until ? 0 : 600_000)
    const canModify = signedIn && comment.is_owner && now < deadline
    return <article className="conversation-comment" key={comment.id}>
      <span className="fan-avatar" aria-hidden="true">{comment.author.split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span>
      <div className="comment-content"><div className="conversation-comment-meta"><strong>@{comment.author}</strong><time dateTime={comment.created_at}>{timeAgo(comment.created_at)}</time>{comment.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}{signedIn && comment.is_owner && <details className="comment-options" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false }}><summary aria-label={`Options for your comment by ${comment.author}`} title={canModify ? 'Edit or delete your comment' : 'The 10-minute editing window has ended'}>⋮</summary><div className="comment-options-panel"><button aria-label="Edit comment" disabled={busy || !canModify} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onEdit(comment) }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/></svg>Edit</button><button aria-label="Delete comment" disabled={busy || !canModify} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(comment) }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7"/></svg>Delete</button><small>{canModify ? 'Edit or delete within 10 minutes of posting.' : 'The 10-minute editing window has ended.'}</small></div></details>}</div>
        {comment.image && <img className="community-comment-image" src={comment.image} alt="Image attached to this comment"/>}
        <p className="conversation-body">{comment.reply_to_author && <strong className="reply-mention">@{comment.reply_to_author} </strong>}{comment.body}</p>
        {comment.id === root.id && children}
        {allowReply && <div className="forum-entry-actions comment-actions"><button disabled={busy} onClick={() => { setExpanded(true); onReply(comment) }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4h2A8.5 8.5 0 0 1 21 11.5Z"/></svg>Reply</button></div>}
        {activeCommentId === comment.id && composer}
      </div>
    </article>
  }
  return <div className="comment-thread">{render(root)}{replies.length > 0 && <button className="comment-expand" aria-expanded={showReplies} onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{showReplies ? '⌃' : '⌄'}</span>{showReplies ? 'Hide' : 'Show'} {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</button>}{showReplies && <div className="comment-thread-replies">{replies.map(render)}</div>}</div>
}
