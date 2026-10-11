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
globalThis.document = {addEventListener(){}, removeEventListener(){}, activeElement: null}
globalThis.window = {localStorage: {getItem: () => null, setItem() {}}}
function compile(source) {
  let {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}})
  outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
}
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const explore = await import(compile((await read('../src/lib/explore.ts')).replace("import type { Media, SurprisePick } from './types'", '')))
globalThis.__explore = explore
const source = (await read('../src/components/SurprisePick.tsx'))
  .replace("import { Link } from 'react-router-dom'", "const Link = 'a'")
  .replace("import { motion, useReducedMotion } from 'motion/react'", "const motion = {div: 'div'}; const useReducedMotion = () => true")
  .replace("import { api } from '../lib/api'", 'const api = {}')
  .replace(/import \{ demoStartUrl[^\n]+\n/, 'const {demoStartUrl, describePick, dismissTip, browserStorage, startUrl, universeUrl} = globalThis.__explore\n')
  .replace(/import type [^\n]+\n/, '')
  .replace("import './SurprisePick.css'", '')
const {SurpriseDialog} = await import(compile(source))
const SurpriseTip = (await import(compile((await read('../src/components/SurpriseTip.tsx'))
  .replace(/import \{ browserStorage[^\n]+\n/, 'const {browserStorage, dismissTip} = globalThis.__explore\n').replace("import './SurprisePick.css'", '')))).default

const pick = (id, over = {}) => ({media: {id, title: `T ${id}`, type: 'anime', progress_unit: 'episode', total_units: 12, total_units_known: true, description: '',
  anilist_id: 1, has_prologue: false, cover_url: null, format: 'TV', release_date: {year: 2011}}, start_progress: 1, hook: 'A hook.', tags: ['adventure'],
  characters_at_start: 5, pool_size: 7, ...over})

test('the three actions build the documented URLs', () => {
  const item = pick('anilist-10087')
  assert.equal(explore.startUrl(item), '/explore?media=anilist-10087&progress=1&view=characters&from=surprise')
  assert.equal(explore.universeUrl(item), '/explore?media=anilist-10087')
  assert.match(explore.demoStartUrl, /^\/explore\?media=lantern-harbor&progress=1&view=characters/)
})

test('progress and view params are parsed strictly and clamped to the media', () => {
  const parse = query => explore.parseExploreParams(new URLSearchParams(query))
  assert.deepEqual(parse(''), {view: null, progress: null, fromSurprise: false})
  assert.deepEqual(parse('media=x&progress=1&view=characters&from=surprise'), {view: 'characters', progress: 1, fromSurprise: true})
  assert.equal(parse('progress=0').progress, 0)
  for (const bad of ['progress=-1', 'progress=1.5', 'progress=abc', 'progress=', 'progress=1e3', 'progress=%201', 'progress=99999999999999']) assert.equal(parse(bad).progress, null, bad)
  assert.equal(parse('view=universe').view, null); assert.equal(parse('view=Characters').view, null); assert.equal(parse('from=other').fromSurprise, false)
  assert.equal(explore.clampProgress(1, 12), 1); assert.equal(explore.clampProgress(500, 12), 12); assert.equal(explore.clampProgress(0, 12), 0)
  assert.equal(explore.clampProgress(-4, 12), 0); assert.equal(explore.clampProgress(3, 1), 1)
})

test('pick descriptions stay spoiler-safe and handle prologues and plurals', () => {
  assert.deepEqual(explore.describePick(pick('a')), {meta: 'TV · 2011 · 12 episodes', characters: '5 characters to meet in episode 1', start: 'Start at episode 1'})
  const ubw = explore.describePick(pick('b', {media: {...pick('b').media, has_prologue: true, total_units: 13}, characters_at_start: 1}))
  assert.equal(ubw.meta, 'TV · 2011 · 12 episodes'); assert.equal(ubw.characters, '1 character to meet in the prologue'); assert.equal(ubw.start, 'Start at the prologue')
  const demo = explore.describePick(pick('lantern-harbor', {media: {...pick('x').media, format: null, release_date: null, total_units: 3}}))
  assert.equal(demo.meta, 'ANIME · 3 episodes')
  assert.equal(explore.describePick(pick('one', {media: {...pick('x').media, total_units: 1}})).meta, 'TV · 2011 · 1 episode')
})

test('the explainer remembers its dismissal and never throws when storage is blocked', () => {
  const values = new Map(); const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}
  assert.equal(explore.tipDismissed(storage), false); explore.dismissTip(storage); assert.equal(explore.tipDismissed(storage), true)
  const blocked = {getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }}
  assert.equal(explore.tipDismissed(blocked), false); assert.doesNotThrow(() => explore.dismissTip(blocked)); assert.equal(explore.tipDismissed(null), false)
})

const text = node => typeof node === 'string' ? node : node?.children?.map(text).join(' ') ?? ''
async function render(element) {
  let renderer
  await act(async () => { renderer = create(element, {createNodeMock: () => ({showModal() {}, close() {}, focus() {}})}) }); await act(async () => {})
  return renderer
}
const click = (renderer, label) => renderer.root.findAll(node => node.type === 'button' && text({children: node.children}).includes(label))[0]

test('"Pick another" asks for a different story by sending the current id as exclude', async () => {
  const calls = []; const queue = [pick('anilist-10087'), pick('anilist-21')]
  const service = {surprise: async (exclude, signal) => { calls.push({exclude, aborted: signal?.aborted}); return queue.shift() }}
  const renderer = await render(createElement(SurpriseDialog, {onClose() {}, service}))
  assert.deepEqual(calls.map(call => call.exclude), [undefined])
  assert.match(text(renderer.toJSON()), /T anilist-10087/); assert.match(text(renderer.toJSON()), /5 characters to meet in episode 1/)
  await act(async () => { click(renderer, 'Pick another').props.onClick() }); await act(async () => {})
  assert.deepEqual(calls.map(call => call.exclude), [undefined, 'anilist-10087'])
  assert.match(text(renderer.toJSON()), /T anilist-21/)
  const links = renderer.root.findAll(node => node.type === 'a').map(node => node.props.to)
  assert.deepEqual(links, ['/explore?media=anilist-21&progress=1&view=characters&from=surprise', '/explore?media=anilist-21'])
})

test('a failed pick shows a retry and the demo link instead of an empty card', async () => {
  let attempts = 0
  const service = {surprise: async () => { if (attempts++ === 0) throw new Error('Surprise unavailable'); return pick('anilist-223') }}
  const renderer = await render(createElement(SurpriseDialog, {onClose() {}, service}))
  const content = text(renderer.toJSON())
  assert.match(content, /We lost the signal/); assert.match(content, /Surprise unavailable/); assert.match(content, /Lantern Harbor demo/)
  await act(async () => { click(renderer, 'Try again').props.onClick() }); await act(async () => {})
  assert.match(text(renderer.toJSON()), /T anilist-223/)
})

test('the explainer states the core idea and can be dismissed', async () => {
  let dismissed = false
  const renderer = await render(createElement(SurpriseTip, {onDismiss: () => { dismissed = true }}))
  assert.match(text(renderer.toJSON()), /only what’s revealed by episode 1/); assert.match(text(renderer.toJSON()), /nothing past your episode is ever shown/)
  await act(async () => { click(renderer, 'Got it').props.onClick() }); assert.equal(dismissed, true)
})
