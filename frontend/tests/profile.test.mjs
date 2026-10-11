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
globalThis.window = {localStorage: {getItem: () => null, setItem() {}}}
globalThis.HTMLDialogElement = class {}
function compile(source) {
  let {outputText} = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}})
  outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_,quote,name) => `from ${JSON.stringify(name === '../lib/pageTransition' ? new URL('../src/lib/pageTransition.ts', import.meta.url).href : pathToFileURL(require.resolve(name)).href)}`)
  return 'data:text/javascript;base64,'+Buffer.from(outputText).toString('base64')
}
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const library = await import(compile((await read('../src/lib/library.ts')).replace("import { request } from './api'", 'const request = () => {}')))
globalThis.__library = library
const profileLib = await import(compile((await read('../src/lib/profile.ts')).replace("import { request } from './api'", 'const request = () => {}').replace("import type { SavedUniverse } from './library'", '')))
globalThis.__profile = profileLib
const screenSource = (await read('../src/components/ProfilePage.tsx'))
  .replace("import { Link } from 'react-router-dom'", "const Link = 'a'")
  .replace("import { motion, useReducedMotion } from 'motion/react'", "const motion = {section:'section', div:'div'}; const useReducedMotion = () => true")
  .replace("import { authClient } from '../lib/auth'", 'const authClient = null')
  .replace("import { libraryApi, libraryStats } from '../lib/library'", 'const {libraryApi, libraryStats} = globalThis.__library')
  .replace(/import \{ browserStorage[^\n]+\n/, 'const {browserStorage, celebrationKey, defaultAvatar, markCelebrated, pendingCelebration, pointRules, profileApi, rankProgress, readCelebrated} = globalThis.__profile\n')
  .replace("import AppNavbar from './AppNavbar'", 'const AppNavbar = () => null')
  .replace("import GlitterStars from './GlitterStars'", 'const GlitterStars = () => null')
  .replace("import './ProfilePage.css'", '')
const {ProfileScreen} = await import(compile(screenSource))

const title = (id, completed, minutes = 0) => ({media_id: id, title: id, type: 'anime', completed, estimated_minutes_watched: minutes, cover_url: null, release_date: null})
const universe = (id, titles) => ({media_id: id, title: `U ${id}`, type: 'anime', format: 'TV', cover_url: null, titles,
  viewed_count: titles.filter(t => t.completed).length, total_count: titles.length, coverage_incomplete: false, pinned: false, rating: null,
  saved_at: '2026-01-01T00:00:00Z', last_explored_at: '2026-01-01T00:00:00Z'})
const voyager = {id: 'voyager', title: 'Voyager', min_points: 50, badge: '/badges/voyager.svg'}
const stargazer = {id: 'stargazer', title: 'Stargazer', min_points: 0, badge: null}

test('shared stat helpers count shared worlds once and agree with the backend rules', () => {
  const items = [universe('a', [title('x', true, 264), title('y', false, 22)]), universe('b', [title('x', true, 66), title('z', true, 0)])]
  const stats = library.libraryStats(items)
  assert.deepEqual({...stats, estimatedHours: undefined}, {universesSaved: 2, exploring: 1, universesCompleted: 1, worldsCompleted: 2, estimatedHours: undefined})
  assert.equal(stats.estimatedHours, library.estimatedHoursWatched(items))
  assert.equal(stats.estimatedHours, (264 + 22) / 60)
  assert.deepEqual(library.libraryStats([]), {universesSaved: 0, exploring: 0, universesCompleted: 0, worldsCompleted: 0, estimatedHours: 0})
})

test('rank progress is clamped and worded for singular, plural and the top rank', () => {
  const base = {rank: stargazer, next_rank: voyager}
  assert.deepEqual(profileLib.rankProgress({...base, points: 0, points_to_next: 50}), {percent: 0, label: '50 points to Voyager'})
  assert.deepEqual(profileLib.rankProgress({...base, points: 25, points_to_next: 25}), {percent: 50, label: '25 points to Voyager'})
  assert.equal(profileLib.rankProgress({...base, points: 49, points_to_next: 1}).label, '1 point to Voyager')
  assert.equal(profileLib.rankProgress({...base, points: 90, points_to_next: 0}).percent, 100)
  assert.deepEqual(profileLib.rankProgress({rank: voyager, next_rank: null, points: 80, points_to_next: 0}), {percent: 100, label: 'Top rank reached'})
})

function fakeStorage(initial) {
  const values = new Map(initial ? [['k', initial]] : [])
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }}
}
test('the celebration is offered once per earned rank', () => {
  const badges = [{id: 'voyager', title: 'Voyager', image: '/badges/voyager.svg', earned_at: '2026-02-01T00:00:00Z'}]
  const storage = fakeStorage()
  assert.equal(profileLib.pendingCelebration(badges, profileLib.readCelebrated(storage, 'k'))?.id, 'voyager')
  profileLib.markCelebrated(storage, 'k', 'voyager'); profileLib.markCelebrated(storage, 'k', 'voyager')
  assert.deepEqual(profileLib.readCelebrated(storage, 'k'), ['voyager'])
  assert.equal(profileLib.pendingCelebration(badges, profileLib.readCelebrated(storage, 'k')), null)
  assert.equal(profileLib.pendingCelebration([], []), null)
  const next = {id: 'next', title: 'Next', image: '/n.svg', earned_at: '2026-03-01T00:00:00Z'}
  assert.equal(profileLib.pendingCelebration([...badges, next], ['voyager'])?.id, 'next')
})
test('celebration storage failures and corrupt values never throw', () => {
  const broken = {getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }}
  assert.deepEqual(profileLib.readCelebrated(broken, 'k'), [])
  assert.doesNotThrow(() => profileLib.markCelebrated(broken, 'k', 'voyager'))
  assert.deepEqual(profileLib.readCelebrated(fakeStorage('{not json'), 'k'), [])
  assert.deepEqual(profileLib.readCelebrated(fakeStorage('{"a":1}'), 'k'), [])
  assert.deepEqual(profileLib.readCelebrated(null, 'k'), [])
})

const text = node => typeof node === 'string' ? node : node?.children?.map(text).join(' ') ?? ''
async function render(element) {
  let renderer; await act(async () => { renderer = create(element, {createNodeMock: () => ({showModal() {}, close() {}})}) }); await act(async () => {}); return renderer
}
const profile = (over = {}) => ({points: 20, rank: stargazer, next_rank: voyager, points_to_next: 30,
  breakdown: {world_completed: 10, universe_completed: 0, universe_saved: 5, community_post: 5},
  stats: {universes_saved: 1, worlds_completed: 1, universes_completed: 0, estimated_minutes_watched: 0},
  favorite: null, badges: [], ranks: [stargazer, voyager], ...over})

test('signed-out visitors get a sign-in prompt and no network calls', async () => {
  const calls = []
  const renderer = await render(createElement(ProfileScreen, {viewer: null, profileService: {get: () => calls.push('p')}, libraryService: {list: () => calls.push('l')}}))
  assert.match(text(renderer.toJSON()), /Sign in to see your profile/); assert.deepEqual(calls, [])
})
test('signed-in profile shows name, title, four stat tiles, locked badge and the favorite picker', async () => {
  const items = [universe('anilist-1', [title('anilist-1', true, 264)])]
  const renderer = await render(createElement(ProfileScreen, {viewer: {id: 'u', name: 'Ada'},
    profileService: {get: async () => profile()}, libraryService: {list: async () => items}}))
  const content = text(renderer.toJSON())
  for (const expected of [/Ada/, /Stargazer/, /30 points to Voyager/, /Universes saved/, /Worlds completed/, /Universes completed/, /Est\. hours watched/,
    /Locked · 50 points/, /Pick the universe you love most/, /U anilist-1/, /How points work/]) assert.match(content, expected)
  assert.equal(renderer.root.findAll(node => node.props.className === 'profile-stats')[0].findAll(node => node.type === 'li').length, 4)
})
test('a freshly earned badge opens the celebration', async () => {
  const earned = [{id: 'voyager', title: 'Voyager', image: '/badges/voyager.svg', earned_at: '2026-02-01T00:00:00Z'}]
  const renderer = await render(createElement(ProfileScreen, {viewer: {id: 'celebrated-test', name: 'Ada'},
    profileService: {get: async () => profile({rank: voyager, next_rank: null, points_to_next: 0, points: 50, badges: earned})}, libraryService: {list: async () => []}}))
  assert.match(text(renderer.toJSON()), /You’re now a\s+Voyager/)
})
