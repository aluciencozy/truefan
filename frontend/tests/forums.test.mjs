import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {test} from 'node:test'
import {createElement} from 'react'
import {act,create} from 'react-test-renderer'
import ts from 'typescript'
const require=createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT=true
function compile(source){let {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});outputText=outputText.replace(/from (["'])([^"']+)\1/g,(_,q,name)=>`from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64')}
const helpers=(await readFile(new URL('../src/lib/community.ts',import.meta.url),'utf8')).replace("import { request } from './api'",'const request=()=>{}')
globalThis.__forumHelpers=await import(compile(helpers))
globalThis.__boardModule=(await import(compile((await readFile(new URL('../src/components/DetectiveBoard.tsx',import.meta.url),'utf8')).replace("import '@xyflow/react/dist/style.css'", '').replace("import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges } from '@xyflow/react'", "const applyNodeChanges=(_,nodes)=>nodes;const ReactFlow='flow';const Background='background';const Controls='controls';const Handle='handle';const Position={Left:'left',Right:'right'}"))))
globalThis.__clueDraft=globalThis.__boardModule.clueDraft
globalThis.__forumCommentThread=(await import(compile((await readFile(new URL('../src/components/CommentThread.tsx',import.meta.url),'utf8')).replace("import { timeAgo } from '../lib/community'",'const {timeAgo}=globalThis.__forumHelpers')))).default
const source=(await readFile(new URL('../src/components/ForumParticipation.tsx',import.meta.url),'utf8')).replace("import CommentThread from './CommentThread'",'const CommentThread=globalThis.__forumCommentThread').replace("import CommunityAttachment from './CommunityAttachment'", 'const CommunityAttachment=()=>null').replace("import DetectiveBoard, { clueDraft } from './DetectiveBoard'", 'const DetectiveBoard=()=>null;const clueDraft=globalThis.__clueDraft').replace("import { Link } from 'react-router-dom'","const Link='a'").replace("import { communityApi, forumRooms } from '../lib/community'",'const {communityApi,forumRooms}=globalThis.__forumHelpers')
const Forum=(await import(compile(source))).default
const post={...globalThis.__forumHelpers.examplePosts.find(p=>p.room==='capsule'),example:false,is_owner:true}
const entry={id:'guess',author:'Fan',created_at:post.created_at,is_owner:true,kind:'prediction',body:'My guess',side:'neutral',source:'',artwork:'',connects_to:null,contains_spoilers:false,locked:true,revealed:false,tried:false}
async function mount(entries=[],overrides={},signedIn=true){let r;const service={entries:async()=>entries,...overrides};await act(async()=>{r=create(createElement(Forum,{post,signedIn,spoilers:false,service}))});return r}
const buttons=r=>r.root.findAllByType('button')
const named=(r,label)=>buttons(r).find(b=>b.children.includes(label)||b.children.join('')===label)
test('locked predictions expose reveal confirmation and never offer edit or delete',async()=>{let action;const r=await mount([entry],{entryAction:async(id,value)=>{action={id,value};return entry}});try{assert.equal(named(r,'Edit'),undefined);assert.equal(named(r,'Delete'),undefined);await act(async()=>named(r,'Reveal after watching episode 1').props.onClick());assert.equal(action,undefined);await act(async()=>named(r,'I watched it — reveal').props.onClick());assert.deepEqual(action,{id:'guess',value:'reveal'})}finally{await act(async()=>r.unmount())}})
test('editing own contribution preserves fields and failures preserve the draft',async()=>{let payload;const r=await mount([{...entry,locked:false}],{saveEntry:async(...args)=>{payload=args;throw Error('Save failed')}});try{await act(async()=>named(r,'Edit').props.onClick());const textarea=r.root.findByType('textarea');assert.equal(textarea.props.value,'My guess');await act(async()=>textarea.props.onChange({target:{value:'Better guess'}}));await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(payload[3],'guess');assert.equal(payload[1].body,'Better guess');assert.equal(r.root.findByType('textarea').props.value,'Better guess');assert.equal(r.root.findByProps({role:'alert'}).children.join(''),'Save failed')}finally{await act(async()=>r.unmount())}})
test('guests can read but receive a sign-in link instead of a contribution form',async()=>{const r=await mount([],{},false);try{assert.equal(r.root.findAllByType('form').length,0);assert.equal(r.root.findByType('a').props.to,'/auth/sign-in')}finally{await act(async()=>r.unmount())}})
test('Charlotte watchlist saving resolves the actual ID and preserves completion without unlocking future content',async()=>{
 const calls=[];globalThis.__watchlistRequest=async(path,signal,auth,options)=>{calls.push({path,auth,options});if(path.startsWith('/api/media/search'))return [{id:'anilist-20997',title:'Charlotte'}];if(path.includes('?media_id='))return [{completed:true}];return {}}
 const original=await readFile(new URL('../src/lib/community.ts',import.meta.url),'utf8')
 const module=await import(compile(original.replace("import { request } from './api'",'const request=(...args)=>globalThis.__watchlistRequest(...args)')))
 await module.communityApi.saveCharlotte();assert.equal(calls[2].path,'/api/me/media-state/anilist-20997');assert.equal(calls[2].auth,true);assert.deepEqual(JSON.parse(calls[2].options.body),{completed:true});assert.equal(calls[2].options.method,'PUT')
})

test('detective board saves owned positions and connections and excludes hidden endpoints',async()=>{
 const clue={...entry,kind:'clue',id:'one',locked:false,board_x:10,board_y:20,shape:'diamond'}
 const other={...clue,id:'two',is_owner:false,connects_to:'hidden'}
 const saves=[];let r;await act(async()=>{r=create(createElement(globalThis.__boardModule.default,{clues:[clue,other],busy:false,onSave:async(...args)=>saves.push(args)}))})
 try {
  const flow=()=>r.root.findByType('flow')
  assert.equal(flow().props.nodes.find(n=>n.id==='two').draggable,false)
  assert.equal(flow().props.edges.length,0)
  await act(async()=>flow().props.onNodeDragStop(null,{id:'one',position:{x:160,y:90}}))
  assert.equal(saves[0][1].board_x,160);assert.equal(saves[0][1].shape,'diamond')
  await act(async()=>flow().props.onConnect({source:'one',target:'two'}));assert.equal(saves[1][1].connects_to,'two')
  await act(async()=>flow().props.onConnect({source:'two',target:'one'}));assert.equal(saves.length,2)
 }finally{await act(async()=>r.unmount())}
})


test('artwork has owner dots and replies to replies keep their target and inline composer',async()=>{
 const artwork={...entry,id:'art',kind:'art',locked:false,created_at:new Date().toISOString(),artwork:'data:image/png;base64,test'}
 const first={id:'first',entry_id:'art',author:'Sam',body:'Nice artwork',created_at:artwork.created_at,contains_spoilers:false}
 const nested={...first,id:'nested',entry_id:null,parent_id:'first',author:'Jo',reply_to_author:'Sam',body:'I agree'}
 let target;let r
 await act(async()=>{r=create(createElement(Forum,{post:{...post,room:'drawing'},signedIn:true,spoilers:false,service:{entries:async()=>[artwork]},comments:[first,nested],onReply:c=>{target=c},activeCommentId:'nested',composer:createElement('form',{'aria-label':'Inline reply'},'Writing to Jo')}))})
 try {
  assert.equal(r.root.findAllByProps({className:'conversation-comment'}).length,3)
  assert.equal(r.root.findAllByProps({className:'comment-options'}).length,1)
  assert.equal(r.root.findByProps({className:'community-comment-image'}).props.src,artwork.artwork)
  const nestedArticle=r.root.findAllByProps({className:'conversation-comment'})[2]
  await act(async()=>nestedArticle.findAllByType('button').find(b=>b.children.includes('Reply')).props.onClick())
  assert.equal(target.id,'nested');assert.equal(target.parent_id,'first')
  assert.equal(nestedArticle.findByProps({'aria-label':'Inline reply'}).children.join(''),'Writing to Jo')
 }finally{await act(async()=>r.unmount())}
})
