import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import DetectiveBoard, { clueDraft } from './DetectiveBoard'
import CommunityAttachment from './CommunityAttachment'
import { communityApi, forumRooms } from '../lib/community'
import type { CommunityPost, EntryDraft, ForumEntry } from '../lib/community'

const empty = (post: CommunityPost): EntryDraft => ({kind:post.room==='capsule'?'prediction':post.room==='mystery'?'clue':post.room==='drawing'?'art':post.room==='matchmaking'?'recommendation':post.room==='verdict'?'impression':'contribution',body:'',side:'neutral',source:'',artwork:'',connects_to:null,contains_spoilers:post.contains_spoilers})
export default function ForumParticipation({post,signedIn,spoilers,service=communityApi}: {post:CommunityPost;signedIn:boolean;spoilers:boolean;service?:typeof communityApi}) {
  const [entries,setEntries]=useState<ForumEntry[]>([])
  const [draft,setDraft]=useState<EntryDraft>(()=>empty(post))
  const [editing,setEditing]=useState<string>()
  const [error,setError]=useState(''), [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false), [loading,setLoading]=useState(true)
  const [imageBusy,setImageBusy]=useState(false)
  const [revision,setRevision]=useState(0)
  const [confirmReveal,setConfirmReveal]=useState<string>()
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{const controller=new AbortController();setEntries([]);setLoading(true)
    service.entries(post.id,spoilers,signedIn,controller.signal).then(data=>{if(!controller.signal.aborted)setEntries(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[post.id,spoilers,signedIn,service,revision])
  const lockedPrediction=post.room==='capsule'&&entries.some(e=>e.kind==='prediction'&&e.is_owner&&e.locked)
  const room=forumRooms.find(r=>r.id===post.room)
  const sides=post.room==='courtroom'||post.room==='battle'||post.room==='hot-take'
  const clues=entries.filter(e=>e.kind==='clue')
  async function run(work:()=>Promise<unknown>,message:string) {if(busy)return;setBusy(true);setError('');setNotice('');try{await work();if(alive.current){setRevision(v=>v+1);setNotice(message)}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not save')}finally{if(alive.current)setBusy(false)}}
  async function save(event:FormEvent) {event.preventDefault();if(imageBusy)return;await run(async()=>{await service.saveEntry(post.id,draft,spoilers,editing);if(alive.current){setDraft(empty(post));setEditing(undefined)}},'Your contribution is saved.')}
  function sideName(e:ForumEntry) {return e.side==='a'?post.side_a||'Prosecution':e.side==='b'?post.side_b||'Defense':e.side==='neutral'?'':e.side==='believable'?'Most believable':'Most devastating'}
  return <section className="forum-participation" aria-label={`${room?.name || 'Forum'} participation`}>
    <h3>{room?.name}</h3><p>{room?.description}</p>
    {error&&<p role="alert" className="community-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {post.room==='pitch'&&post.media.toLowerCase()==='charlotte'&&<button className="community-primary" disabled={busy||!signedIn} onClick={()=>void run(()=>service.saveCharlotte(),'Charlotte is in your saved universes.')}>Add Charlotte to watchlist</button>}
    {sides&&<div className="forum-sides">{(['a','b'] as const).map(side=><div className="community-card" key={side}><h4>{side==='a'?post.side_a||'Prosecution':post.side_b||'Defense'}</h4><p>{entries.filter(e=>e.kind==='join'&&e.side===side).length} joined · {entries.filter(e=>e.kind==='vote'&&e.side===side).length} votes</p>
      <button disabled={!signedIn||busy} onClick={()=>void run(()=>service.saveEntry(post.id,{...empty(post),kind:'join',side},spoilers),'Your side is saved. You can switch sides.')}>Join {side==='a'?post.side_a||'Prosecution':post.side_b||'Defense'}</button>
      {entries.filter(e=>e.kind==='contribution'&&e.side===side).map(e=><p key={e.id}>{e.body}<small> — {e.source}</small></p>)}</div>)}</div>}
    {sides&&post.room!=='battle'&&<div className="forum-jury community-card"><h4>Community jury</h4><p>Review both sides and deliver your verdict. One vote per fan; you can change your vote.</p><div className="forum-entry-actions">{(['a','b'] as const).map(side=><button key={side} className={side==='a'?'community-primary':undefined} disabled={!signedIn||busy} onClick={()=>void run(()=>service.saveEntry(post.id,{...empty(post),kind:'vote',side},spoilers),'Your verdict is recorded. You can change your vote.')}>{post.room==='courtroom'?(side==='a'?'Guilty':'Not guilty'):(side==='a'?post.side_a||'For':post.side_b||'Against')} ({entries.filter(e=>e.kind==='vote'&&e.side===side).length})</button>)}</div></div>}
    {post.room==='drawing'&&<button disabled={!signedIn||busy} onClick={()=>void run(()=>service.saveEntry(post.id,{...empty(post),kind:'join',side:'a'},spoilers),'You joined the drawing challenge. Upload your drawing whenever it is ready.')}>Join drawing challenge</button>}
    {post.room==='mystery'&&<DetectiveBoard clues={clues} busy={busy} onSave={async(entry,changes)=>{await run(()=>service.saveEntry(post.id,changes,spoilers,entry.id),'Board saved.')}}/>}
    {loading?<p role="status">Loading contributions…</p>:<div className="forum-entry-list">{entries.map(e=><article className="forum-entry" key={e.id}><header><strong>{e.author}</strong><span>{e.kind} {sideName(e)}</span>{e.contains_spoilers&&<span className="spoiler-badge">Spoilers</span>}</header>{e.artwork&&<img className="forum-artwork" src={e.artwork} alt={e.body}/> }<p>{e.body}</p>{e.source&&<small>{e.source}</small>}{e.connects_to&&<p>Connected to: {clues.find(c=>c.id===e.connects_to)?.body}</p>}
      {e.kind==='prediction'&&<p>{e.locked?(e.revealed?'Revealed · Original prediction unchanged':'Locked · Editing disabled'):'Draft · Only you can see it'}</p>}
      {e.tried&&<span className="spoiler-badge">Requester tried this recommendation</span>}
      <div className="forum-entry-actions">{e.is_owner&&!e.locked&&<><button disabled={busy} onClick={()=>{setEditing(e.id);setDraft(clueDraft(e))}}>Edit</button><button disabled={busy} onClick={()=>{if(window.confirm('Delete your contribution?'))void run(()=>service.removeEntry(e.id),'Contribution deleted.')}}>Delete</button></>}
      {e.is_owner&&e.kind==='prediction'&&!e.locked&&<button disabled={busy} onClick={()=>{if(window.confirm('Lock this prediction? You cannot edit or delete it afterward.'))void run(()=>service.entryAction(e.id,'lock',spoilers),'Prediction locked.')}}>Lock prediction</button>}
      {e.is_owner&&e.locked&&!e.revealed&&<button disabled={busy} onClick={()=>setConfirmReveal(e.id)}>Reveal after watching episode {post.target_episode||1}</button>}
      {post.is_owner&&e.kind==='recommendation'&&<button disabled={busy} onClick={()=>void run(()=>service.entryAction(e.id,'tried',spoilers),'Recommendation updated.')}>{e.tried?'Undo tried':'Mark tried'}</button>}
      {post.room==='ending'&&e.kind==='contribution'&&(['believable','devastating'] as const).map(side=><button key={side} disabled={!signedIn||busy} onClick={()=>void run(()=>service.saveEntry(post.id,{...empty(post),kind:'vote',side,source:e.id},spoilers),'Your ending vote is saved.')}>Vote {side} ({entries.filter(v=>v.kind==='vote'&&v.side===side&&v.source===e.id).length})</button>)}</div>
    </article>)}</div>}
    {confirmReveal&&<div className="community-notice"><p>Have you watched episode {post.target_episode||1}? Revealing makes your prediction visible to other fans.</p><button disabled={busy} onClick={()=>void run(async()=>{await service.entryAction(confirmReveal,'reveal',spoilers);setConfirmReveal(undefined)},'Prediction revealed.')}>I watched it — reveal</button><button onClick={()=>setConfirmReveal(undefined)}>Keep sealed</button></div>}
    {signedIn&&lockedPrediction?<p>Your prediction is locked. Use the reveal button after watching.</p>:signedIn?<form className="forum-entry-form" onSubmit={event=>void save(event)}><h4>{editing?'Edit your contribution':post.room==='drawing'?'Share a drawing':post.room==='capsule'?'Write your prediction':post.room==='verdict'?'Record an impression or final verdict':'Add your contribution'}</h4>
      {sides&&<label>Your side<select value={draft.side} onChange={e=>setDraft(d=>({...d,side:e.target.value as EntryDraft['side']}))}><option value="neutral">Choose a side</option><option value="a">{post.side_a}</option><option value="b">{post.side_b}</option></select></label>}
      {post.room==='ending'&&draft.kind==='vote'&&<label>Verdict<select value={draft.side} onChange={e=>setDraft(d=>({...d,side:e.target.value as EntryDraft['side']}))}><option value="believable">Most believable</option><option value="devastating">Most devastating</option></select></label>}
      <label>{post.room==='matchmaking'?'Show and reason':post.room==='drawing'?'Title and artist notes':post.room==='mystery'?'Clue and explanation':'Your message'}<textarea required={draft.kind!=='join'&&draft.kind!=='vote'} rows={4} maxLength={5000} value={draft.body} onChange={e=>setDraft(d=>({...d,body:e.target.value}))}/></label>
      <label>{post.room==='verdict'?'Episode / First impression or final verdict':'Episode / Scene reference'}<input maxLength={200} value={draft.source} onChange={e=>setDraft(d=>({...d,source:e.target.value}))}/></label>
      {post.room==='drawing'&&<CommunityAttachment value={draft.artwork} disabled={busy} onChange={artwork=>setDraft(d=>({...d,artwork}))} onError={setError} onBusyChange={setImageBusy}/>}
      {post.room==='mystery'&&<label>Shape<select value={draft.shape || 'rectangle'} onChange={e=>setDraft(d=>({...d,shape:e.target.value as EntryDraft['shape']}))}><option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="diamond">Diamond</option></select></label>}
      {post.room==='mystery'&&<label>Connect to<select value={draft.connects_to||''} onChange={e=>setDraft(d=>({...d,connects_to:e.target.value||null}))}><option value="">Standalone clue</option>{clues.filter(e=>e.id!==editing).map(e=><option key={e.id} value={e.id}>{e.body.slice(0,80)}</option>)}</select></label>}
      <label className="community-checkbox"><input type="checkbox" checked={draft.contains_spoilers} onChange={e=>setDraft(d=>({...d,contains_spoilers:e.target.checked}))}/>Contains spoilers</label>
      <button className="community-primary" disabled={busy||imageBusy}>{busy?'Saving…':editing?'Save changes':post.room==='capsule'?'Save prediction draft':'Post contribution'}</button>{editing&&<button type="button" onClick={()=>{setEditing(undefined);setDraft(empty(post))}}>Cancel edit</button>}
    </form>:<Link className="community-primary" to="/auth/sign-in">Sign in to participate</Link>}
  </section>
}
