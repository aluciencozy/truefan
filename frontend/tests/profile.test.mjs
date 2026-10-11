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
  .replace(/import \{ badgeTrack[^\n]+\n/, 'const {badgeTrack, browserStorage, celebrationCopy, celebrationFor, celebrationKey, defaultAvatar, highestBadge, markCelebrated, pointRules, profileApi, rankProgress, readCelebrated, trackValueText} = globalThis.__profile\n')
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

const comet = {id: 'comet', title: 'Comet', min_points: 150, badge: '/badges/comet.svg'}
const solaris = {id: 'solaris', title: 'Solaris', min_points: 300, badge: '/badges/solaris.svg'}
const ranks = [stargazer, voyager, comet, solaris]
const earnedFor = points => ranks.filter(rank => rank.badge && points >= rank.min_points).map(rank => ({id: rank.id, title: rank.title, image: rank.badge, earned_at: '2026-10-11T12:00:00Z'}))
const track = points => profileLib.badgeTrack(points, ranks, earnedFor(points), () => 'DATE')
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`)

test('badgeTrack: segment fills at every checkpoint', () => {
  const expected = {0: [0, 0, 0], 25: [50, 0, 0], 50: [100, 0, 0], 100: [100, 50, 0], 150: [100, 100, 0], 225: [100, 100, 50], 300: [100, 100, 100], 400: [100, 100, 100]}
  for (const [points, fills] of Object.entries(expected)) {
    const result = track(Number(points))
    assert.equal(result.max, 300); assert.equal(result.segments.length, 3)
    result.segments.forEach((segment, index) => near(segment.fill, fills[index]))
  }
  assert.deepEqual(track(0).segments.map(segment => [segment.from, segment.to]), [['stargazer', 'voyager'], ['voyager', 'comet'], ['comet', 'solaris']])
})

test('badgeTrack: nodes are earned, next or locked, and only the next goal pulses', () => {
  const states = points => track(points).nodes.map(node => node.state).join(',')
  assert.equal(states(0), 'next,locked,locked'); assert.equal(states(25), 'next,locked,locked'); assert.equal(states(49), 'next,locked,locked')
  assert.equal(states(50), 'earned,next,locked'); assert.equal(states(100), 'earned,next,locked'); assert.equal(states(149), 'earned,next,locked')
  assert.equal(states(150), 'earned,earned,next'); assert.equal(states(225), 'earned,earned,next')
  assert.equal(states(300), 'earned,earned,earned'); assert.equal(states(400), 'earned,earned,earned')
  assert.equal(track(100).next.id, 'comet'); assert.equal(track(225).next.id, 'solaris'); assert.equal(track(300).next, null); assert.equal(track(0).next.id, 'voyager')
  // A node stays gray until it is actually earned, even if the points are enough (earned state comes from the server's badges).
  assert.equal(profileLib.badgeTrack(60, ranks, []).nodes[0].state, 'next')
})

test('badgeTrack: positions are proportional by points with an equal-spacing alternative', () => {
  const result = track(0)
  assert.deepEqual(result.nodes.map(node => node.id), ['voyager', 'comet', 'solaris'])
  near(result.nodes[0].position, 50 / 300 * 100); near(result.nodes[1].position, 50); near(result.nodes[2].position, 100)
  near(result.nodes[0].equalPosition, 100 / 3); near(result.nodes[1].equalPosition, 200 / 3); near(result.nodes[2].equalPosition, 100)
  near(result.segments[0].start, 0); near(result.segments[0].end, 50 / 3); near(result.segments[2].end, 100)
  near(result.segments[1].equalStart, 100 / 3); near(result.segments[1].equalEnd, 200 / 3)
  for (const [index, segment] of result.segments.entries()) { if (index) near(segment.start, result.segments[index - 1].end); if (index) near(segment.equalStart, result.segments[index - 1].equalEnd) }
})

test('badgeTrack: tooltips say how far to go or when the badge was earned', () => {
  const result = track(118)
  assert.equal(result.nodes[0].tooltip, 'Voyager · Earned DATE')
  assert.equal(result.nodes[1].tooltip, 'Comet · 150 points · 32 points to go'); assert.equal(result.nodes[1].pointsToGo, 32)
  assert.equal(result.nodes[2].tooltip, 'Solaris · 300 points · 182 points to go')
  assert.equal(track(149).nodes[1].tooltip, 'Comet · 150 points · 1 point to go')
})

test('progress text: valuetext and the label under the track', () => {
  assert.equal(profileLib.trackValueText(120, 300, voyager, comet), '120 of 300 points, Voyager, 30 points to Comet')
  assert.equal(profileLib.trackValueText(1, 300, stargazer, voyager), '1 of 300 points, Stargazer, 49 points to Voyager')
  assert.equal(profileLib.trackValueText(300, 300, solaris, null), '300 of 300 points, Solaris, top rank reached')
  assert.equal(profileLib.trackValueText(412, 300, solaris, null), '412 points, Solaris, top rank reached')
  assert.equal(profileLib.rankProgress({rank: solaris, next_rank: null, points: 320, points_to_next: 0}).label, 'Top rank reached')
})

test('the celebration names the highest new badge, however the badges are ordered', () => {
  const all = earnedFor(320)
  const shuffled = [all[2], all[0], all[1]]  // storage order must not matter
  assert.equal(profileLib.highestBadge(shuffled, ranks).id, 'solaris')
  assert.equal(profileLib.pendingCelebration(shuffled, [], ranks).id, 'solaris')
  assert.equal(profileLib.pendingCelebration(shuffled, ['solaris'], ranks).id, 'comet')
  const celebration = profileLib.celebrationFor(shuffled, [], ranks)
  assert.deepEqual([celebration.badge.id, celebration.more, celebration.unseen], ['solaris', 2, ['voyager', 'comet', 'solaris']])
  assert.deepEqual(profileLib.celebrationFor(all, ['voyager'], ranks).unseen, ['comet', 'solaris'])
  assert.equal(profileLib.celebrationFor(all, ['voyager', 'comet', 'solaris'], ranks), null)
  assert.equal(profileLib.celebrationFor([], [], ranks), null)
})
test('celebration copy works for any tier and mentions extra badges', () => {
  const badge = title => ({id: title.toLowerCase(), title, image: '/x.svg', earned_at: 'x'})
  assert.deepEqual(profileLib.celebrationCopy({badge: badge('Voyager'), more: 0}), {heading: 'You’re now a Voyager', body: 'Your Voyager badge stays yours, even if your progress changes.'})
  assert.equal(profileLib.celebrationCopy({badge: badge('Comet'), more: 0}).heading, 'You’re now a Comet')
  assert.match(profileLib.celebrationCopy({badge: badge('Solaris'), more: 2}).body, /also earned 2 more badges/)
  assert.match(profileLib.celebrationCopy({badge: badge('Comet'), more: 1}).body, /also earned 1 more badge on/)
  for (const tier of ['Voyager', 'Comet', 'Solaris']) assert.doesNotMatch(profileLib.celebrationCopy({badge: badge(tier), more: 0}).body, /first/i)
})

test('profile page: accessible badge track, three shelf badges and a multi-badge celebration', async () => {
  const badges = earnedFor(320)
  const renderer = await render(createElement(ProfileScreen, {viewer: {id: 'tiers-test', name: 'Ada'},
    profileService: {get: async () => profile({points: 320, rank: solaris, next_rank: null, points_to_next: 0, badges, ranks})}, libraryService: {list: async () => []}}))
  const content = text(renderer.toJSON())
  assert.match(content, /You’re now a\s+Solaris/); assert.match(content, /also earned 2 more badges/)
  const bar = renderer.root.findAll(node => node.props.role === 'progressbar')[0]
  assert.deepEqual([bar.props['aria-valuemin'], bar.props['aria-valuemax'], bar.props['aria-valuenow']], [0, 300, 300])
  assert.equal(bar.props['aria-valuetext'], '320 points, Solaris, top rank reached')
  assert.equal(renderer.root.findAll(node => node.type === 'li' && /track-node/.test(node.props.className ?? '')).length, 3)
  assert.equal(renderer.root.findAll(node => node.type === 'span' && node.props.role === 'tooltip').length, 3)
  assert.match(content, /Top rank reached/)
})
test('profile page: mid-way points show the goal and pending tooltips', async () => {
  const renderer = await render(createElement(ProfileScreen, {viewer: {id: 'mid-test', name: 'Ada'},
    profileService: {get: async () => profile({points: 120, rank: voyager, next_rank: comet, points_to_next: 30, badges: earnedFor(120), ranks})}, libraryService: {list: async () => []}}))
  const bar = renderer.root.findAll(node => node.props.role === 'progressbar')[0]
  assert.equal(bar.props['aria-valuetext'], '120 of 300 points, Voyager, 30 points to Comet')
  const classes = renderer.root.findAll(node => node.type === 'li' && /track-node/.test(node.props.className ?? '')).map(node => node.props.className)
  assert.deepEqual(classes, ['track-node earned', 'track-node next', 'track-node locked'])
  assert.match(text(renderer.toJSON()), /Comet · 150 points · 30 points to go/)
})
