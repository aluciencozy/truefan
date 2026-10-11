import { useEffect, useState } from 'react'
import type { CommunityComment } from '../lib/community'
import { timeAgo } from '../lib/community'

interface Props {
  root: CommunityComment
  comments: CommunityComment[]
  busy: boolean
  signedIn: boolean
  onReply: (comment: CommunityComment) => void
  onEdit: (comment: CommunityComment) => void
  onDelete: (comment: CommunityComment) => void
}
export default function CommentThread({ root, comments, busy, signedIn, onReply, onEdit, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  function descendants(id: string): CommunityComment[] {
    return comments.filter(c => c.parent_id === id).flatMap(c => [c, ...descendants(c.id)])
  }
  const replies = descendants(root.id)
  function render(comment: CommunityComment) {
    const deadline = Date.parse(comment.editable_until || comment.created_at) + (comment.editable_until ? 0 : 600_000)
    const canModify = signedIn && comment.is_owner && now < deadline
    return <article className="conversation-comment" key={comment.id}>
      <span className="fan-avatar">{comment.author.split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span>
      <div className="comment-content"><div className="conversation-comment-meta"><strong>@{comment.author}</strong><time dateTime={comment.created_at}>{timeAgo(comment.created_at)}</time>{comment.contains_spoilers && <span className="spoiler-badge">Spoilers</span>}{canModify && <details className="comment-options" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false }}><summary aria-label={`Options for your comment by ${comment.author}`} title="Edit or delete within 10 minutes of posting">⋮</summary><div className="comment-options-panel"><button disabled={busy} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onEdit(comment) }}>✎ Edit</button><button disabled={busy} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(comment) }}>Delete</button><small>Available for 10 minutes after posting</small></div></details>}</div>
        {comment.image && <img className="community-comment-image" src={comment.image} alt="Image attached to this comment"/>}
        <p className="conversation-body">{comment.reply_to_author && <strong className="reply-mention">@{comment.reply_to_author} </strong>}{comment.body}</p>
        <div className="forum-entry-actions"><button disabled={busy || !signedIn} onClick={() => { setExpanded(true); onReply(comment) }}>Reply</button></div>
      </div>
    </article>
  }
  return <div className="comment-thread">{render(root)}{replies.length > 0 && <button className="comment-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide' : 'Show'} {replies.length} {replies.length === 1 ? 'reply' : 'replies'} ▾</button>}{expanded && <div className="comment-thread-replies">{replies.map(render)}</div>}</div>
}
