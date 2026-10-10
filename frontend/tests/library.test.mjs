import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'
const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.document = {addEventListener(){},removeEventListener(){},activeElement:null}
function compile(source) {
  let {outputText} = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}})
  outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_,quote,name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
  return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64')
}
const librarySource = (await readFile(new URL('../src/lib/library.ts',import.meta.url),'utf8')).replace("import { request } from './api'",'const request = () => {}')
const helpers=await import(compile(librarySource))
globalThis.__libraryHelpers=helpers
const source=(await readFile(new URL('../src/components/LibraryPage.tsx',import.meta.url),'utf8'))
  .replace("import { Link } from 'react-router-dom'","const Link = 'a'")
  .replace("import { AnimatePresence, motion, useReducedMotion } from 'motion/react'","const AnimatePresence = ({children}) => children; const motion = {div:'div',article:'article'}; const useReducedMotion = () => true")
  .replace("import { authClient } from '../lib/auth'",'const authClient = null')
  .replace("import { libraryApi, libraryArt as art, libraryOrder, universeStatus } from '../lib/library'",'const {libraryApi, libraryArt:art, libraryOrder, universeStatus} = globalThis.__libraryHelpers')
  .replace("import './LibraryPage.css'",'')
  .replace("import GlitterStars from './GlitterStars'",'const GlitterStars=()=>null')
  .replace("import AppNavbar from './AppNavbar'", 'const AppNavbar=()=>null')
const {LibraryScreen}=await import(compile(source))
const fixture = n => ({media_id:`anilist-${n}`,title:`Universe ${n}`,type:'anime',format:'TV',cover_url:null,
  titles:[{media_id:`anilist-${n}`,title:`Universe ${n}`,type:'anime',format:'TV',completed:n%2===0,release_date:null,cover_url:null}],
  viewed_count:n%2===0?1:0,total_count:1,pinned:false,rating:null,coverage_incomplete:false,
  saved_at:`2026-01-0${n}T00:00:00Z`,last_explored_at:`2026-01-0${n}T00:00:00Z`})
const viewer={id:'a',name:'Fan'}
const nodeMock=()=>({showModal(){},close(){},focus(){},contains(){return false},querySelector(){return null}})
const button=(renderer,text)=>renderer.root.findAllByType('button').find(node=>node.children.join('')===text)
const label=(renderer,text)=>renderer.root.findByProps({'aria-label':text})
const rows=renderer=>renderer.root.findAllByType('article')
async function mount(service,user=viewer) {let renderer; await act(async()=>{renderer=create(createElement(LibraryScreen,{viewer:user,service}),{createNodeMock:nodeMock})});return renderer}

test('library repeats three constellations, filters completed works, searches members, and switches layout',async()=>{
  const renderer=await mount({list:async()=>[1,2,3,4,5,6].map(fixture)})
  try {
    assert.equal(rows(renderer).length,6)
    const maps=renderer.root.findAllByType('img').filter(node=>helpers.libraryArt.maps.includes(node.props.src)).map(node=>node.props.src)
    assert.deepEqual(maps,[...helpers.libraryArt.maps,...helpers.libraryArt.maps])
    await act(async()=>button(renderer,'Completed').props.onClick())
    assert.equal(rows(renderer).length,3)
    await act(async()=>button(renderer,'All universes[object Object]').props.onClick())
    await act(async()=>label(renderer,'Search saved universes').props.onChange({target:{value:'Universe 1'}}))
    assert.equal(rows(renderer).length,1)
    await act(async()=>label(renderer,'Grid view').props.onClick())
    assert.equal(label(renderer,'Grid view').props['aria-pressed'],true)
  } finally {await act(async()=>renderer.unmount())}
})

test('pin and rate persist API results; cancel preserves a universe; abandon waits for success and displays empty state',async()=>{
  let item=fixture(1); const calls=[]; let fail=true
  const service={list:async()=>[item],update:async(id,prefs)=>{calls.push({id,prefs});item={...item,...prefs};return item},abandon:async id=>{calls.push({id,abandon:true});if(fail)throw new Error('Offline');return {media_id:id,abandoned:true}}}
  const renderer=await mount(service)
  try {
    async function menu(action) {await act(async()=>label(renderer,'Options for Universe 1').props.onClick());await act(async()=>button(renderer,action).props.onClick())}
    await menu('📌 Pin'); assert.equal(calls[0].prefs.pinned,true)
    await menu('⭐ Rate');await act(async()=>label(renderer,'Rate 4 out of 5').props.onClick());await act(async()=>button(renderer,'Save rating').props.onClick())
    assert.equal(calls[1].prefs.rating,4)
    await menu('🚀 Abandon');await act(async()=>button(renderer,'Keep exploring').props.onClick());assert.equal(rows(renderer).length,1)
    await menu('🚀 Abandon');await act(async()=>button(renderer,'Yes, abandon 🚀').props.onClick())
    assert.equal(rows(renderer).length,1);assert.equal(renderer.root.findByProps({role:'alert'}).children.join(''),'Offline')
    fail=false;await act(async()=>button(renderer,'Yes, abandon 🚀').props.onClick())
    assert.equal(rows(renderer).length,0);assert.ok(renderer.root.findAllByType('h2').some(node=>node.children.join('')==='No signals yet ✦'))
  } finally {await act(async()=>renderer.unmount())}
})

test('account switch aborts stale reads and never accepts a previous owners mutation',async()=>{
  const response=Promise.withResolvers();let signal
  const service={list:async s=>{signal=s;return [fixture(1)]},update:async()=>response.promise}
  const renderer=await mount(service)
  try {
    await act(async()=>label(renderer,'Options for Universe 1').props.onClick())
    await act(async()=>{button(renderer,'📌 Pin').props.onClick()})
    await act(async()=>renderer.update(createElement(LibraryScreen,{viewer:null,service})))
    assert.equal(signal.aborted,true);assert.equal(rows(renderer).length,0)
    await act(async()=>response.resolve({...fixture(1),pinned:true}))
    assert.equal(rows(renderer).length,0);assert.equal(renderer.root.findAllByProps({role:'status'}).length,0)
  } finally {await act(async()=>renderer.unmount())}
})

test('a failed library read presents retry instead of the empty-library message',async()=>{
  const renderer=await mount({list:async()=>{throw new Error('Storage unavailable')}})
  try {assert.equal(renderer.root.findByProps({role:'alert'}).children.join(''),'Storage unavailable');assert.ok(button(renderer,'Try again'))}
  finally {await act(async()=>renderer.unmount())}
})
