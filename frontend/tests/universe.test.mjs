import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildUniverseModel, displayLinks, visibleUniverse } from '../src/lib/universeModel.ts'
import { buildReleaseGuide, compareRelease, confirmProgress, releaseLabel, unlockMedia, unlocksAfter, worldTitle } from '../src/lib/universeProgression.ts'
import { groupBounds, fallbackPositions, layoutUniverse, MEDIA_WIDTH, MEDIA_HEIGHT, anchorLayout, WORLD_CLEARANCE } from '../src/lib/universeLayout.ts'

const work = (id, year = 2000, month = 1, day = 1) => ({
  id, title: id, type: 'anime', progress_unit: 'episode', total_units: 12, total_units_known: true,
  description: 'No story details.', anilist_id: 1, has_prologue: false, cover_url: null, format: 'TV',
  release_date: year === null ? null : { year, month, day },
})
const edge = (source, target, type) => ({ source, target, type })
const graph = (media, relationships = []) => ({ root_id: media[0]?.id ?? '', media, relationships, truncated: false })
const state = (id, completed = false, unit = 0) => ({ media_id: id, completed, progress: { unit }, manual_unlocked: false })

test('locked world names remain undiscovered until completion, saved progress or manual unlock grants entry', () => {
  const first = work('first'), next = work('SECRET SEQUEL', 2001)
  const model = buildUniverseModel(graph([first, next], [edge(first.id, next.id, 'SEQUEL')]))
  assert.equal(worldTitle(next, buildReleaseGuide(model, {})[next.id]), 'Undiscovered')
  for (const states of [{ first: state('first', true) }, { [next.id]: state(next.id, false, 1) }, unlockMedia({}, next.id), { [next.id]: state(next.id, true) }]) {
    assert.equal(worldTitle(next, buildReleaseGuide(model, states)[next.id]), next.title)
  }
})

test('release sorting retains partial precision, places missing components last, and ties by stable ID', () => {
  const media = [work('unknown', null), work('year', 2001, null, null), work('month', 2001, 3, null), work('full-b', 2001, 3, 8), work('full-a', 2001, 3, 8), work('older', 2000, null, null)]
  assert.deepEqual(media.sort(compareRelease).map(m => m.id), ['older', 'full-a', 'full-b', 'month', 'year', 'unknown'])
  assert.equal(releaseLabel(media.find(m => m.id === 'month')), '2001-03 (month only)')
  assert.equal(releaseLabel(media.find(m => m.id === 'year')), '2001 (year only)')
  assert.equal(releaseLabel(media.find(m => m.id === 'unknown')), 'Release date unknown')
  assert.deepEqual(media.find(m => m.id === 'year').release_date, { year: 2001, month: null, day: null })
})

test('reciprocal sequel/prequel and alternative duplicates normalize without losing raw evidence', () => {
  const g = graph([work('a'), work('b')], [edge('a', 'b', 'SEQUEL'), edge('b', 'a', 'PREQUEL'), edge('a', 'b', 'SEQUEL'), edge('a', 'b', 'ALTERNATIVE'), edge('b', 'a', 'ALTERNATIVE'), edge('a', 'b', 'future_type'), edge('a', 'missing', 'SEQUEL')])
  const m = buildUniverseModel(g)
  assert.equal(m.links.length, 3)
  const sequel = m.links.find(l => l.kind === 'SEQUEL')
  assert.equal(sequel.relations.length, 2)
  assert.equal(sequel.source, 'a'); assert.equal(sequel.target, 'b')
  assert.equal(m.links.find(l => l.kind === 'ALTERNATIVE').directional, false)
  assert.equal(m.links.find(l => l.kind === 'FUTURE_TYPE').relations[0].type, 'future_type')
  assert.notEqual(m.branchByMedia.a, m.branchByMedia.b)
  assert.deepEqual(buildUniverseModel({ ...g, media: [...g.media].reverse(), relationships: [...g.relationships].reverse() }), m)
})

test('alternative routes split even with a common prequel; spinoffs, side stories and adaptations stay separate', () => {
  const m = buildUniverseModel(graph(['zero', 'route-a', 'route-a2', 'route-b', 'spin', 'side', 'source'].map(id => work(id)), [
    edge('zero', 'route-a', 'SEQUEL'), edge('zero', 'route-b', 'SEQUEL'), edge('route-a', 'route-a2', 'SEQUEL'),
    edge('route-a', 'route-b', 'ALTERNATIVE'), edge('zero', 'spin', 'SPIN_OFF'), edge('zero', 'side', 'SIDE_STORY'), edge('source', 'route-a', 'ADAPTATION'),
  ]))
  assert.equal(m.branchByMedia['route-a'], m.branchByMedia['route-a2'])
  assert.equal(m.branchByMedia.zero, m.branchByMedia['route-a'])
  for (const id of ['route-b', 'spin', 'side', 'source']) assert.notEqual(m.branchByMedia[id], m.branchByMedia['route-a'])
  const guide = buildReleaseGuide(m, {})
  assert.equal(Object.values(guide).filter(g => g.status === 'available').length, 1)
  assert.equal(guide['route-b'].status, 'locked'); assert.equal(guide.spin.status, 'locked')
})

test('cycles and multi-parent relations retain cross-links with a cycle-safe primary forest', () => {
  const m = buildUniverseModel(graph(['a', 'b', 'c', 'd'].map(id => work(id)), [edge('a', 'b', 'SEQUEL'), edge('b', 'c', 'SEQUEL'), edge('c', 'a', 'SEQUEL'), edge('d', 'c', 'SEQUEL'), edge('a', 'a', 'OTHER')]))
  assert.equal(m.links.length, 5)
  assert.equal(m.links.filter(l => l.primary).length, 2)
  const parent = new Map(m.links.filter(l => l.primary).map(l => [l.target, l.source]))
  for (const id of m.media.map(m => m.id)) {
    const seen = new Set(); let cursor = id
    while (parent.has(cursor)) { assert.ok(!seen.has(cursor)); seen.add(cursor); cursor = parent.get(cursor) }
  }
  assert.equal(m.branchByMedia.d, m.branchByMedia.c)
})

test('prerequisites follow story connections even when release dates run in reverse', () => {
  const m = buildUniverseModel(graph([work('prequel', 2010), work('sequel', 2000), work('spin', 2005), work('spin2', 2006)], [edge('prequel', 'sequel', 'SEQUEL'), edge('prequel', 'spin', 'SPIN_OFF'), edge('spin', 'spin2', 'SEQUEL')]))
  let guide = buildReleaseGuide(m, {})
  assert.equal(guide.sequel.number, 1); assert.equal(guide.prequel.status, 'available')
  assert.equal(guide.sequel.previousId, 'prequel'); assert.equal(guide.spin.previousId, 'prequel')
  assert.equal(guide.spin.visible, true); assert.equal(guide.spin2.visible, false)
  guide = buildReleaseGuide(m, { prequel: state('prequel', true) })
  assert.equal(guide.sequel.status, 'available'); assert.equal(guide.spin.status, 'available')
  assert.equal(guide.spin2.status, 'locked'); assert.equal(guide.spin2.visible, true)
})

test('override preserves confirmed history; rewinding never reduces units or completion', () => {
  const a = work('a'), b = work('b', 2001)
  const m = buildUniverseModel(graph([a, b], [edge('a', 'b', 'SEQUEL')]))
  const initial = { b: state('b', true, 12), a: state('a', false, 7) }
  const unlocked = unlockMedia(initial, 'b')
  assert.equal(unlocked.b.progress.unit, 12); assert.equal(unlocked.b.completed, true)
  const rewound = confirmProgress(unlocked, b, 2)
  assert.equal(rewound.b.progress.unit, 12); assert.equal(rewound.b.completed, true)
  assert.equal(initial.b.manual_unlocked, false)
  assert.equal(buildReleaseGuide(m, unlockMedia({}, 'b')).b.status, 'available')
  assert.equal(buildReleaseGuide(m, { a: state('a', false, 12) }).a.status, 'available') // explicit backend false wins
  assert.equal(buildReleaseGuide(m, { b: state('b', false, 3) }).b.status, 'available') // preserve an existing start
})

test('unknown totals do not fabricate completion; unknown dates do not bypass prerequisites', () => {
  const prologue = { ...work('p'), has_prologue: true, total_units: 13 }
  assert.equal(confirmProgress({}, prologue, 1).p.completed, false)
  assert.equal(confirmProgress({}, prologue, 13).p.completed, true)
  const unknown = { ...work('u', null), total_units_known: false, total_units: 1 }
  assert.equal(confirmProgress({}, unknown, 1).u.completed, false)
  assert.equal(confirmProgress({}, { ...unknown, total_units_known: undefined }, 1).u.completed, false)
  const m = buildUniverseModel(graph([work('p'), unknown], [edge('p', 'u', 'SEQUEL')]))
  assert.equal(buildReleaseGuide(m, {}).u.status, 'locked')
  assert.equal(buildReleaseGuide(m, { p: state('p', true) }).u.status, 'available')
  assert.equal(buildReleaseGuide(m, {}).u.approximateDate, true)
})

test('empty/single graphs and shuffled inputs have stable finite ELK geometry', async () => {
  assert.deepEqual(await layoutUniverse(buildUniverseModel(graph([]))), {})
  const one = await layoutUniverse(buildUniverseModel(graph([work('a')])))
  assert.equal(Object.keys(one).length, 1); assert.ok(Number.isFinite(one.a.x))
  const g = graph(['a','b','c','d','e'].map(id => work(id)), [edge('a','b','SEQUEL'), edge('b','c','SEQUEL'), edge('a','d','SPIN_OFF'), edge('c','e','ALTERNATIVE')])
  const first = await layoutUniverse(buildUniverseModel(g))
  const second = await layoutUniverse(buildUniverseModel({ ...g, media: [...g.media].reverse(), relationships: [...g.relationships].reverse() }))
  assert.deepEqual(first, second)
})

test('large disconnected franchises preserve all nodes with no overlapping cards', async () => {
  const media = Array.from({ length: 50 }, (_, i) => work(`n${String(i).padStart(2, '0')}`))
  const relationships = media.slice(1, 40).map((m, i) => edge(media[i].id, m.id, i % 8 === 0 ? 'SPIN_OFF' : 'SEQUEL'))
  const m = buildUniverseModel(graph(media, relationships))
  const positions = await layoutUniverse(m)
  assert.equal(Object.keys(positions).length, 50)
  for (let i = 0; i < media.length; i++) for (let j = i+1; j < media.length; j++) {
    const a = positions[media[i].id], b = positions[media[j].id]
    assert.ok(Math.abs(a.x-b.x) >= MEDIA_WIDTH || Math.abs(a.y-b.y) >= MEDIA_HEIGHT)
  }
})

test('growth rebalances deterministically while the focused world stays anchored', async () => {
  const m = buildUniverseModel(graph(['a', 'b', 'c', 'd'].map(id => work(id)), [edge('a','b','SEQUEL'), edge('b','c','SEQUEL'), edge('b','d','SIDE_STORY')]))
  const frontier = states => visibleUniverse(m, new Set(Object.entries(buildReleaseGuide(m, states)).filter(([, g]) => g.visible).map(([id]) => id)))
  const initial = await layoutUniverse(frontier({}))
  assert.deepEqual(Object.keys(initial).sort(), ['a', 'b'])
  const expanded = frontier({ a: state('a', true) })
  const proposed = await layoutUniverse(expanded)
  const positions = anchorLayout(proposed, initial, 'a')
  assert.deepEqual(positions.a, initial.a)
  assert.ok(positions.c); assert.ok(positions.d)
  const [main, related] = groupBounds(expanded, positions)
  assert.ok(main.y + main.height + 180 <= related.y + .001)
})

test('an OVA prequel stays separate from TV release progression without rewriting its relation', () => {
  const ova = { ...work('ova', 2014), format: 'OVA' }, tv = work('tv', 2013), season = work('season', 2017)
  const m = buildUniverseModel(graph([ova, tv, season], [edge('tv', 'ova', 'PREQUEL'), edge('tv', 'season', 'SEQUEL')]))
  assert.notEqual(m.branchByMedia.ova, m.branchByMedia.tv)
  assert.equal(m.branchByMedia.tv, m.branchByMedia.season)
  const guide = buildReleaseGuide(m, { tv: state('tv', true) })
  assert.equal(guide.season.status, 'available'); assert.equal(guide.ova.status, 'locked')
  assert.equal(guide.ova.previousId, null); assert.equal(guide.ova.visible, false)
  assert.deepEqual(m.groups[0].mediaIds, ['season', 'tv'])
  assert.equal(buildReleaseGuide(m, {}).tv.status, 'available')
  assert.equal(buildReleaseGuide(m, {}).ova.status, 'locked')
  assert.equal(m.links.find(l => l.source === 'ova').relations[0].type, 'PREQUEL')
})

test('optional format continuations do not split the coherent TV-season release branch', () => {
  const main = work('main', 2000), sequel = work('sequel', 2002), extra = { ...work('extra', 2001), format: 'SPECIAL' }
  const m = buildUniverseModel(graph([main, sequel, extra], [edge('main','sequel','SEQUEL'), edge('main','extra','SEQUEL')]))
  assert.equal(m.branchByMedia.main, m.branchByMedia.sequel)
  assert.notEqual(m.branchByMedia.main, m.branchByMedia.extra)
  assert.equal(buildReleaseGuide(m, {}).sequel.status, 'locked')
  assert.equal(buildReleaseGuide(m, { main: state('main', true) }).sequel.status, 'available')
})

test('sequel forks and multiple parents stay together without explicit alternative evidence', () => {
  const m = buildUniverseModel(graph(['a', 'b', 'c', 'd'].map(id => work(id)), [
    edge('a', 'b', 'SEQUEL'), edge('a', 'c', 'SEQUEL'), edge('b', 'd', 'SEQUEL'), edge('c', 'd', 'SEQUEL'),
  ]))
  assert.equal(m.branches.length, 1)
  assert.deepEqual(m.groups.map(g => g.label), ['Main storyline'])
})

test('one main-series start is available; related groups unlock at their connected main entry', () => {
  const media = [work('s1', 2000), work('s2', 2001), work('spin', 2002), work('spin2', 2003), work('unknown', null), work('unconnected', 2004)]
  const m = buildUniverseModel(graph(media, [edge('s1', 's2', 'SEQUEL'), edge('s2', 'spin', 'SPIN_OFF'), edge('spin', 'spin2', 'SEQUEL'), edge('s1', 'unknown', 'SIDE_STORY')]))
  assert.deepEqual(m.groups.map(g => [g.label, g.mediaIds]), [
    ['Main storyline', ['s1', 's2']], ['Extras & spinoffs', ['spin', 'spin2', 'unconnected', 'unknown']],
  ])
  const fresh = buildReleaseGuide(m, {})
  assert.deepEqual(Object.keys(fresh).filter(id => fresh[id].status === 'available'), ['s1'])
  assert.equal(fresh.spin.previousId, 's2'); assert.equal(fresh.unconnected.previousId, null)
  const watched = buildReleaseGuide(m, { s1: state('s1', true) })
  assert.equal(watched.s2.status, 'available'); assert.equal(watched.spin.status, 'locked')
  assert.equal(watched.unknown.status, 'available'); assert.equal(watched.unconnected.status, 'locked'); assert.equal(watched.unconnected.visible, false)
  assert.equal(buildReleaseGuide(m, { s2: state('s2', true) }).spin.status, 'available')
  assert.equal(buildReleaseGuide(m, { spin: state('spin', false, 1) }).spin.status, 'available')
  assert.equal(buildReleaseGuide(m, unlockMedia({}, 'spin2')).spin2.status, 'available')
})

test('opening a spinoff follows parent evidence back to the main series', () => {
  for (const relation of [edge('main', 'spin', 'SPIN_OFF'), edge('main', 'spin', 'SIDE_STORY'), edge('spin', 'main', 'PARENT')]) {
    for (const root_id of ['spin', 'spin2']) {
      const m = buildUniverseModel({ ...graph([work('main'), work('spin', 2001), work('spin2', 2002)], [relation, edge('spin', 'spin2', 'SEQUEL')]), root_id })
      assert.deepEqual(m.groups[0].mediaIds, ['main'])
      assert.equal(buildReleaseGuide(m, {}).spin.status, 'locked')
      assert.equal(buildReleaseGuide(m, {}).spin2.status, 'locked')
    }
  }
})

test('main and related works have separate clusters in automatic and fallback layouts', async () => {
  const m = buildUniverseModel(graph([work('main'), work('s2', 2001), work('spin', 2002), work('spin2', 2003), work('side', 2004)], [
    edge('main', 's2', 'SEQUEL'), edge('s2', 'spin', 'SPIN_OFF'), edge('spin', 'spin2', 'SEQUEL'), edge('main', 'side', 'SIDE_STORY'),
  ]))
  for (const positions of [await layoutUniverse(m), fallbackPositions(m)]) {
    const [main, related] = groupBounds(m, positions)
    assert.equal(main.label, 'Main storyline'); assert.equal(related.label, 'Extras & spinoffs')
    assert.ok(main.y + main.height < related.y)
  }
})

test('world positions have stable vertical variation while preserving sequel order and card spacing', async () => {
  const media = Array.from({ length: 12 }, (_, i) => work(`season-${String(i).padStart(2, '0')}`))
  const universe = graph(media, media.slice(1).map((m, i) => edge(media[i].id, m.id, 'SEQUEL')))
  const model = buildUniverseModel(universe)
  for (const positions of [await layoutUniverse(model), fallbackPositions(model)]) {
    assert.ok(new Set(Object.values(positions).map(p => p.y)).size > 1)
    const heights = Object.values(positions).map(p => p.y)
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 84)
    for (let i = 1; i < media.length; i++) {
      assert.ok(positions[media[i].id].x - positions[media[i - 1].id].x >= MEDIA_WIDTH)
      assert.notEqual(positions[media[i].id].y, positions[media[i - 1].id].y)
    }
  }
  const shuffled = buildUniverseModel({ ...universe, media: [...media].reverse(), relationships: [...universe.relationships].reverse() })
  assert.deepEqual(await layoutUniverse(model), await layoutUniverse(shuffled))
  assert.deepEqual(fallbackPositions(model), fallbackPositions(shuffled))
})

test('fallback keeps forked extras and enlarged worlds apart', () => {
  const media = Array.from({ length: 22 }, (_, i) => work(`side-${i}`))
  const model = buildUniverseModel(graph(media, media.slice(1).map(m => edge(media[0].id, m.id, 'SIDE_STORY'))))
  const positions = fallbackPositions(model)
  assert.equal(Object.keys(positions).length, media.length)
  const points = Object.values(positions)
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    assert.ok(Math.abs(points[i].x - points[j].x) >= WORLD_CLEARANCE || Math.abs(points[i].y - points[j].y) >= WORLD_CLEARANCE)
  }
})

const visibleIds = guide => Object.keys(guide).filter(id => guide[id].visible).sort()
test('one-layer frontier grows on completion, exposes both forks, and previews only actual unlocks', () => {
  const m = buildUniverseModel(graph(['a','b','c','d','e','extra','extra2'].map(id => work(id)), [
    edge('a','b','SEQUEL'), edge('a','extra','SIDE_STORY'), edge('b','c','SEQUEL'), edge('b','d','SEQUEL'),
    edge('c','e','SEQUEL'), edge('extra','extra2','SEQUEL'),
  ]))
  const fresh = buildReleaseGuide(m, {})
  assert.deepEqual(visibleIds(fresh), ['a','b','extra'])
  assert.deepEqual(unlocksAfter(m, fresh, 'a').sort(), ['b','extra'])
  assert.deepEqual(unlocksAfter(m, fresh, 'b'), [])
  const first = buildReleaseGuide(m, { a: state('a', true) })
  assert.deepEqual(visibleIds(first), ['a','b','c','d','extra','extra2'])
  assert.equal(first.b.status, 'available'); assert.equal(first.c.status, 'locked')
  assert.deepEqual(unlocksAfter(m, first, 'b').sort(), ['c','d'])
  const second = buildReleaseGuide(m, { a: state('a', true), b: state('b', true) })
  assert.equal(second.c.status, 'available'); assert.equal(second.d.status, 'available')
  assert.equal(second.e.status, 'locked'); assert.equal(second.e.visible, true)
})

test('sequel movies continue the main story while side stories and their descendants remain extras', () => {
  const media = [work('a'), { ...work('film', 2001), format: 'MOVIE' }, work('b', 2002), { ...work('bonus', 2003), format: 'MOVIE' }, work('spin', 2004)]
  const m = buildUniverseModel(graph(media, [edge('a','film','SEQUEL'), edge('film','b','SEQUEL'), edge('a','bonus','SIDE_STORY'), edge('bonus','spin','SEQUEL')]))
  assert.deepEqual(m.groups[0].mediaIds, ['a','b','film'])
  assert.deepEqual(m.groups[1].mediaIds, ['bonus','spin'])
  const guide = buildReleaseGuide(m, { a: state('a', true) })
  assert.equal(guide.film.status, 'available'); assert.equal(guide.b.status, 'locked')
  assert.equal(guide.b.previousId, 'film')
})

test('out-of-order overrides preserve ancestors as context without expanding locked ancestors', () => {
  const m = buildUniverseModel(graph(['a','b','c','d','sibling'].map(id => work(id)), [edge('a','b','SEQUEL'), edge('b','c','SEQUEL'), edge('c','d','SEQUEL'), edge('b','sibling','SIDE_STORY')]))
  for (const states of [unlockMedia({}, 'c'), { c: state('c', false, 2) }, { c: state('c', true) }]) {
    const guide = buildReleaseGuide(m, states)
    assert.deepEqual(visibleIds(guide), ['a','b','c','d'])
    assert.equal(guide.b.status, 'locked'); assert.equal(guide.sibling.visible, false)
  }
  assert.equal(buildReleaseGuide(m, unlockMedia({}, 'c')).d.status, 'locked')
})

test('multiple parents prefer the latest preceding release, reject cycles, and do not infer disconnected prerequisites', () => {
  const m = buildUniverseModel(graph([work('a', 2000), work('b', 2001), work('c', 2002), work('d', 2003), work('other', 1990)], [edge('a','b','SEQUEL'), edge('a','c','SEQUEL'), edge('b','d','SEQUEL'), edge('c','d','SEQUEL'), edge('d','a','SEQUEL')]))
  const guide = buildReleaseGuide(m, {})
  assert.equal(guide.d.previousId, 'c'); assert.equal(m.startId, 'a')
  assert.equal(guide.other.visible, false); assert.equal(guide.other.previousId, null)
})

test('related overlay merges pairs, omits unlock duplicates, and never exposes hidden descendants', () => {
  const m = buildUniverseModel(graph(['a','b','c','extra'].map(id => work(id)), [edge('a','b','SEQUEL'), edge('b','c','SEQUEL'), edge('a','extra','SIDE_STORY'), edge('a','b','OTHER'), edge('b','extra','CHARACTER'), edge('extra','b','OTHER')]))
  const visible = visibleUniverse(m, new Set(visibleIds(buildReleaseGuide(m, {}))))
  assert.deepEqual(visible.media.map(m => m.id), ['a','b','extra'])
  assert.equal(displayLinks(visible, false).length, 2)
  const overlay = displayLinks(visible, true)
  assert.equal(overlay.length, 3)
  assert.equal(overlay.find(l => !l.primary).relations.length, 2)
  assert.ok(overlay.every(l => l.source !== 'c' && l.target !== 'c'))
})
