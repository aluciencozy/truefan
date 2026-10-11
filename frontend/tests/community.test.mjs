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
const source=(await readFile(new URL('../src/components/CommunityPage.tsx',import.meta.url),'utf8'))
 .replace("import { Link, useNavigate, useSearchParams } from 'react-router-dom'", "const Link='a'; const useNavigate=()=>()=>{}; const useSearchParams=()=>[new URLSearchParams()]")
 .replace("import { authClient } from '../lib/auth'",'const authClient=null')
 .replace("import { communityApi, examplePosts, timeAgo, visitorId, forumRooms } from '../lib/community'",'const {communityApi,examplePosts,timeAgo,visitorId,forumRooms}=globalThis.__communityHelpers')
 .replace("import CommunityShell, { CommunityIcon, LittleUniverse } from './CommunityShell'",'const CommunityShell=({children})=>children; const CommunityIcon=()=>null; const LittleUniverse=()=>null')
 .replace("import CommunityModal from './CommunityModal'",'const CommunityModal=globalThis.__communityModal')
 .replace("import ForumParticipation from './ForumParticipation'",'const ForumParticipation=()=>null')
 .replace("import './CommunityPage.css'",'')
const {CommunityScreen}=await import(compile(source))
const posts=globalThis.__communityHelpers.examplePosts.map(post=>({...post,example:false,room:null}))
const event={preventDefault(){}}
const title=(r,i=0)=>r.root.findAllByProps({className:'post-open'})[i]
const form=r=>r.root.findByProps({className:'conversation-reply-form'})
const body=r=>r.root.findByProps({id:'comment-body'})
async function mount(overrides={},viewer={id:'user',name:'Fan'}) {
 const service={feed:async()=>({posts,media:[],active_fans:0,has_more:false}),comments:async()=>[],...overrides};let r
 await act(async()=>{r=create(createElement(CommunityScreen,{viewer,service}),{createNodeMock:()=>({showModal(){},close(){}})})})
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230))});return r
}
test('Discussions opens with its own feed; category tabs reset pagination and filter on the server',async()=>{
 const calls=[];const r=await mount({feed:async filters=>{calls.push(filters);return {posts,media:[],active_fans:0,has_more:false}}})
 try {assert.equal(calls[0].category,'discussion');await act(async()=>r.root.findByProps({'aria-label':'Forum categories'}).findAllByType('button')[1].props.onClick());await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230))});assert.equal(calls.at(-1).category,'theory');assert.equal(calls.at(-1).offset,0)} finally {await act(async()=>r.unmount())}
})
test('guests read structured replies with a sign-in action; Escape dismisses the conversation',async()=>{
 const comment={id:'reply',author:'Reader',body:'First paragraph.\nSecond paragraph.',created_at:posts[0].created_at,contains_spoilers:false};const r=await mount({comments:async()=>[comment]},null)
 try {await act(async()=>title(r).props.onClick());assert.equal(body(r).props.disabled,true);assert.ok(r.root.findAllByType('a').some(node=>node.children.join('')==='Sign in to reply'));assert.equal(r.root.findByProps({className:'conversation-comment'}).findByProps({className:'conversation-body'}).children.join(''),comment.body);await act(async()=>r.root.findByType('dialog').props.onCancel(event));assert.equal(r.root.findAllByType('dialog').length,0)} finally {await act(async()=>r.unmount())}
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
