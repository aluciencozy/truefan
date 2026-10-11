import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'
const require=createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT=true
globalThis.document={visibilityState:'hidden',addEventListener(){},removeEventListener(){},activeElement:null}
globalThis.HTMLElement=class {}
function compile(source) {
  let {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}})
  outputText=outputText.replace(/from (["'])([^"']+)\1/g,(_,quote,name)=>`from ${JSON.stringify(name === '../lib/pageTransition' ? new URL('../src/lib/pageTransition.ts', import.meta.url).href : pathToFileURL(require.resolve(name)).href)}`)
  return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64')
}
const helpers=(await readFile(new URL('../src/lib/community.ts',import.meta.url),'utf8')).replace("import { request } from './api'",'const request=()=>{}')
globalThis.__communityHelpers=await import(compile(helpers))
globalThis.__communityModal=(await import(compile(await readFile(new URL('../src/components/CommunityModal.tsx',import.meta.url),'utf8')))).default
globalThis.__commentThread=(await import(compile((await readFile(new URL('../src/components/CommentThread.tsx',import.meta.url),'utf8')).replace("import { timeAgo } from '../lib/community'", 'const {timeAgo}=globalThis.__communityHelpers')))).default
globalThis.__attachment=(await import(compile(await readFile(new URL('../src/components/CommunityAttachment.tsx',import.meta.url),'utf8')))).default
const source=(await readFile(new URL('../src/components/CommunityPage.tsx',import.meta.url),'utf8'))
 .replace("import { Link, useNavigate, useSearchParams } from 'react-router-dom'", "const Link='a'; const useNavigate=()=>()=>{}; const useSearchParams=()=>[new URLSearchParams()]")
 .replace("import { authClient } from '../lib/auth'",'const authClient=null')
 .replace("import { communityApi, timeAgo, visitorId, forumRooms } from '../lib/community'",'const {communityApi,examplePosts,timeAgo,visitorId,forumRooms}=globalThis.__communityHelpers')
 .replace("import CommunityShell, { CommunityIcon, LittleUniverse } from './CommunityShell'",'const CommunityShell=({children})=>children; const CommunityIcon=()=>null; const LittleUniverse=()=>null')
 .replace("import CommunityModal from './CommunityModal'",'const CommunityModal=globalThis.__communityModal')
 .replace("import CommunityAttachment from './CommunityAttachment'", 'const CommunityAttachment=globalThis.__attachment')
 .replace("import CommentThread from './CommentThread'", 'const CommentThread=globalThis.__commentThread')
 .replace("import ForumParticipation from './ForumParticipation'",'const ForumParticipation=()=>null')
 .replace("import './CommunityPage.css'",'')
const {CommunityScreen}=await import(compile(source))
const posts=globalThis.__communityHelpers.examplePosts.map(post=>({...post,example:false,room:null}))
const event={preventDefault(){}}
const title=(r,i=0)=>r.root.findAllByProps({className:'post-open'})[i]
const form=r=>r.root.findByProps({className:'conversation-reply-form'})
const body=r=>r.root.findByProps({id:'comment-body'})
async function mount(overrides={},viewer={id:'user',name:'Fan'}) {
 const service={feed:async()=>({posts,media:[],active_fans:0,has_more:false}),comments:async()=>[],post:async id=>posts.find(p=>p.id===id),...overrides};let r
 await act(async()=>{r=create(createElement(CommunityScreen,{viewer,service}),{createNodeMock:()=>({showModal(){},close(){},focus(){},scrollIntoView(){}})})})
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230))});return r
}
test('Discussions opens with its own feed; category tabs reset pagination and filter on the server',async()=>{
 const calls=[];const r=await mount({feed:async filters=>{calls.push(filters);return {posts,media:[],active_fans:0,has_more:false}}})
 try {assert.equal(calls[0].category,'discussion');await act(async()=>r.root.findByProps({'aria-label':'Forum categories'}).findAllByType('button')[1].props.onClick());await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230))});assert.equal(calls.at(-1).category,'theory');assert.equal(calls.at(-1).offset,0)} finally {await act(async()=>r.unmount())}
})
test('guests read structured replies with a sign-in action; Escape dismisses the conversation',async()=>{
 const comment={id:'reply',author:'Reader',body:'First paragraph.\nSecond paragraph.',created_at:posts[0].created_at,contains_spoilers:false};const r=await mount({comments:async()=>[comment]},null)
 try {await act(async()=>title(r).props.onClick());assert.equal(body(r).props.disabled,true);assert.ok(r.root.findAllByType('a').some(node=>node.children.join('')==='Sign in to reply'));assert.equal(r.root.findByProps({className:'conversation-comment'}).findByProps({className:'conversation-body'}).children.filter(c=>typeof c==='string').join(''),comment.body);await act(async()=>r.root.findByType('dialog').props.onCancel(event));assert.equal(r.root.findAllByType('dialog').length,0)} finally {await act(async()=>r.unmount())}
})
test('forum conversations open beside their room navigation and return to the feed',async()=>{
 const post={...posts[0],room:'courtroom'}
 const r=await mount({feed:async()=>({posts:[post],media:[],active_fans:0,has_more:false})},null)
 try {
  await act(async()=>title(r).props.onClick())
  assert.equal(r.root.findAllByType('dialog').length,0)
  assert.equal(r.root.findByProps({className:'forum-thread'}).props['aria-label'],`${post.title} conversation`)
  assert.ok(r.root.findByProps({'aria-label':'Forum rooms'}))
  assert.equal(body(r).props.disabled,true)
  await act(async()=>r.root.findByProps({className:'forum-back'}).props.onClick())
  assert.equal(r.root.findAllByProps({className:'forum-thread'}).length,0)
  assert.equal(title(r).findByType('h2').children.join(''),post.title)
 } finally {await act(async()=>r.unmount())}
})
test('failed replies preserve drafts, spoiler replies stay hidden, and stale errors do not affect a new thread',async()=>{
 let fail=true,payload;const late=Promise.withResolvers();const r=await mount({comment:async(id,text,spoiler)=>{payload={id,text,spoiler};if(fail)throw Error('Could not send');return {id:'reply',author:'Fan',body:text,contains_spoilers:spoiler,created_at:posts[0].created_at}}})
 try {
  await act(async()=>title(r).props.onClick());await act(async()=>body(r).props.onChange({target:{value:'My reply'}}));await act(async()=>form(r).props.onSubmit(event));assert.equal(body(r).props.value,'My reply');assert.equal(r.root.findByProps({role:'alert'}).children.join(''),'Could not send')
  fail=false;await act(async()=>form(r).findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));await act(async()=>form(r).props.onSubmit(event));assert.equal(payload.spoiler,true);assert.equal(r.root.findAllByProps({className:'conversation-comment'}).length,0);assert.equal(body(r).props.value,'')
  r.root.findByType(CommunityScreen).props.service.comment=()=>late.promise
  await act(async()=>body(r).props.onChange({target:{value:'Pending reply'}}));await act(async()=>{form(r).props.onSubmit(event)});await act(async()=>r.root.findByProps({'aria-label':'Close conversation'}).props.onClick());await act(async()=>title(r,1).props.onClick());await act(async()=>late.reject(Error('Old request failed')));assert.equal(r.root.findAllByProps({role:'alert'}).length,0);assert.equal(body(r).props.value,'')
 } finally {await act(async()=>r.unmount())}
})

test('nested replies expand under a main comment and submitting calls the chosen author',async()=>{
 const root={id:'root',author:'Alex',body:'A clue',created_at:posts[0].created_at,contains_spoilers:false,is_owner:false}
 const child={...root,id:'child',author:'Sam',body:'I agree',parent_id:'root',reply_to_author:'Alex'}
 const nested={...root,id:'nested',author:'Jo',body:'Another idea',parent_id:'child',reply_to_author:'Sam'}
 let payload;const items=[root,child,nested]
 const r=await mount({comments:async()=>items,comment:async(...args)=>{payload=args;return {...root,id:'new',parent_id:args[4],reply_to_author:'Sam',body:args[1],is_owner:true}}})
 try {
  await act(async()=>title(r).props.onClick());assert.equal(r.root.findAllByProps({className:'conversation-comment'}).length,1)
  await act(async()=>r.root.findByProps({className:'comment-expand'}).props.onClick());assert.equal(r.root.findAllByProps({className:'conversation-comment'}).length,3)
  const article=r.root.findAllByProps({className:'conversation-comment'})[1]
  await act(async()=>article.findAllByType('button').find(b=>b.children.join('')==='Reply').props.onClick())
  assert.equal(r.root.findByProps({htmlFor:'comment-body'}).children.join(''),'Reply to @Sam')
  await act(async()=>body(r).props.onChange({target:{value:'My response'}}));await act(async()=>form(r).props.onSubmit(event))
  assert.equal(payload[4],'child');assert.equal(payload[1],'My response')
 }finally{await act(async()=>r.unmount())}
})

test('abandoning a reply clears its target and text without sending',async()=>{
 let sends=0;const root={id:'root',author:'Alex',body:'Clue',created_at:posts[0].created_at,contains_spoilers:false}
 const r=await mount({comments:async()=>[root],comment:async()=>{sends++}})
 try{await act(async()=>title(r).props.onClick());await act(async()=>r.root.findByProps({className:'conversation-comment'}).findAllByType('button')[0].props.onClick());await act(async()=>body(r).props.onChange({target:{value:'Draft'}}));await act(async()=>form(r).findAllByType('button').find(b=>b.children.join('')==='Cancel / abandon').props.onClick());assert.equal(body(r).props.value,'');assert.equal(r.root.findByProps({htmlFor:'comment-body'}).children.join(''),'Your comment');assert.equal(sends,0)}finally{await act(async()=>r.unmount())}
})


test('community retains user posts without starter cards or offline sample posts',async()=>{
 const r=await mount()
 try{assert.equal(r.root.findAllByProps({className:'forum-starters'}).length,0);assert.equal(r.root.findAllByProps({className:'community-card post-card'}).length,posts.length);await act(async()=>r.root.findAllByType('button').find(b=>b.children[0]==='Create post ').props.onClick());const titleInput=r.root.findAllByType('input').find(input=>input.props.placeholder==='Give your conversation a title');assert.equal(titleInput.props.value,'')}finally{await act(async()=>r.unmount())}
 const offline=await mount({feed:async()=>{throw Error('Unavailable')}})
 try{assert.equal(offline.root.findAllByProps({className:'community-card post-card'}).length,0);assert.equal(offline.root.findAllByProps({className:'forum-starters'}).length,0)}finally{await act(async()=>offline.unmount())}
})

test('inline comment images and the owner menu follow the ten-minute deadline',async()=>{
 const recent={id:'recent',author:'Alex',body:'Image caption',image:'data:image/png;base64,aGVsbG8=',created_at:new Date(Date.now()-60_000).toISOString(),contains_spoilers:false,is_owner:true}
 const expired={...recent,id:'expired',created_at:new Date(Date.now()-600_001).toISOString()}
 const other={...recent,id:'other',is_owner:false}
 const r=await mount({comments:async()=>[recent,expired,other]})
 try{await act(async()=>title(r).props.onClick());assert.equal(r.root.findAllByProps({className:'community-comment-image'}).length,3);assert.equal(r.root.findAllByProps({className:'comment-options'}).length,1);const menu=r.root.findByProps({className:'comment-options'});await act(async()=>menu.findAllByType('button')[0].props.onClick({currentTarget:{closest:()=>({removeAttribute(){}})}}));assert.equal(body(r).props.value,'Image caption');assert.equal(r.root.findAllByProps({className:'attachment-preview'}).length,1)}finally{await act(async()=>r.unmount())}
})
