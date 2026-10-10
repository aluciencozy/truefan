import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildUniverseModel } from '../src/lib/universeModel.ts'
import { buildReleaseGuide, compareRelease, confirmProgress, releaseLabel, unlockMedia, worldTitle } from '../src/lib/universeProgression.ts'
import { groupBounds, fallbackPositions, layoutUniverse, MEDIA_WIDTH, MEDIA_HEIGHT, preservePositions } from '../src/lib/universeLayout.ts'

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

test('guidance is branch-local release order, independent of story connection direction', () => {
  const m = buildUniverseModel(graph([work('prequel', 2010), work('sequel', 2000), work('spin', 2005), work('spin2', 2006)], [edge('prequel', 'sequel', 'SEQUEL'), edge('prequel', 'spin', 'SPIN_OFF'), edge('spin', 'spin2', 'SEQUEL')]))
  let guide = buildReleaseGuide(m, {})
  assert.equal(guide.sequel.number, 1); assert.equal(guide.prequel.status, 'locked')
  assert.equal(guide.spin.status, 'locked'); assert.equal(guide.spin.previousId, 'prequel'); assert.equal(guide.spin2.status, 'locked')
  assert.equal(guide.spin.branchNumber, guide.spin2.branchNumber)
  guide = buildReleaseGuide(m, { sequel: state('sequel', true) })
  assert.equal(guide.prequel.status, 'available'); assert.equal(guide.spin2.status, 'locked')
  assert.equal(guide.spin.status, 'locked')
  guide = buildReleaseGuide(m, { prequel: state('prequel', true) })
  assert.equal(guide.spin.status, 'available'); assert.equal(guide.spin2.status, 'locked')
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

test('expansion keeps existing anchors; watched/overlay state is absent from geometry inputs', async () => {
  const firstModel = buildUniverseModel(graph([work('a'), work('b')], [edge('a', 'b', 'SEQUEL')]))
  const anchors = await layoutUniverse(firstModel)
  const expanded = buildUniverseModel(graph([work('a'), work('b'), work('c')], [edge('a','b','SEQUEL'), edge('a','c','ALTERNATIVE')]))
  const positions = await layoutUniverse(expanded, anchors)
  assert.deepEqual(positions.a, anchors.a); assert.deepEqual(positions.b, anchors.b)
  assert.ok(positions.c)
  const colliding = preservePositions(expanded, { a: anchors.a, b: anchors.b, c: anchors.a }, anchors)
  assert.ok(Math.abs(colliding.c.x-anchors.a.x) >= MEDIA_WIDTH || Math.abs(colliding.c.y-anchors.a.y) >= MEDIA_HEIGHT)
  const [main, related] = groupBounds(expanded, positions)
  assert.ok(main.y + main.height < related.y)
})

test('an OVA prequel stays separate from TV release progression without rewriting its relation', () => {
  const ova = { ...work('ova', 2014), format: 'OVA' }, tv = work('tv', 2013), season = work('season', 2017)
  const m = buildUniverseModel(graph([ova, tv, season], [edge('tv', 'ova', 'PREQUEL'), edge('tv', 'season', 'SEQUEL')]))
  assert.notEqual(m.branchByMedia.ova, m.branchByMedia.tv)
  assert.equal(m.branchByMedia.tv, m.branchByMedia.season)
  const guide = buildReleaseGuide(m, { tv: state('tv', true) })
  assert.equal(guide.season.status, 'available'); assert.equal(guide.ova.status, 'available')
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
  assert.deepEqual(m.groups.map(g => g.label), ['Main series'])
})

test('one main-series start is available; related groups unlock at their connected main entry', () => {
  const media = [work('s1', 2000), work('s2', 2001), work('spin', 2002), work('spin2', 2003), work('unknown', null), work('unconnected', 2004)]
  const m = buildUniverseModel(graph(media, [edge('s1', 's2', 'SEQUEL'), edge('s2', 'spin', 'SPIN_OFF'), edge('spin', 'spin2', 'SEQUEL'), edge('s1', 'unknown', 'SIDE_STORY')]))
  assert.deepEqual(m.groups.map(g => [g.label, g.mediaIds]), [
    ['Main series', ['s1', 's2']], ['Spinoffs & related works', ['spin', 'spin2', 'unconnected', 'unknown']],
  ])
  const fresh = buildReleaseGuide(m, {})
  assert.deepEqual(Object.keys(fresh).filter(id => fresh[id].status === 'available'), ['s1'])
  assert.equal(fresh.spin.previousId, 's2'); assert.equal(fresh.unconnected.previousId, 's1')
  const watched = buildReleaseGuide(m, { s1: state('s1', true) })
  assert.equal(watched.s2.status, 'available'); assert.equal(watched.spin.status, 'locked')
  assert.equal(watched.unknown.status, 'available'); assert.equal(watched.unconnected.status, 'available')
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

test('main and related works have labeled, nonoverlapping areas in automatic and fallback layouts', async () => {
  const m = buildUniverseModel(graph([work('main'), work('s2', 2001), work('spin', 2002), work('spin2', 2003), work('side', 2004)], [
    edge('main', 's2', 'SEQUEL'), edge('s2', 'spin', 'SPIN_OFF'), edge('spin', 'spin2', 'SEQUEL'), edge('main', 'side', 'SIDE_STORY'),
  ]))
  for (const positions of [await layoutUniverse(m), fallbackPositions(m)]) {
    const [main, related] = groupBounds(m, positions)
    assert.equal(main.label, 'Main series'); assert.equal(related.label, 'Spinoffs & related works')
    assert.ok(main.y + main.height < related.y)
  }
})

test('expansion preserves both groups while adding main seasons and new related branches', async () => {
  const initial = buildUniverseModel(graph([work('main'), work('spin', 2002)], [edge('main', 'spin', 'SPIN_OFF')]))
  const anchors = await layoutUniverse(initial)
  const expanded = buildUniverseModel(graph([work('main'), work('s2', 2001), work('spin', 2002), work('side', 2003)], [
    edge('main', 's2', 'SEQUEL'), edge('main', 'spin', 'SPIN_OFF'), edge('s2', 'side', 'SIDE_STORY'),
  ]))
  const positions = await layoutUniverse(expanded, anchors)
  assert.deepEqual(positions.main, anchors.main); assert.deepEqual(positions.spin, anchors.spin)
  const [main, related] = groupBounds(expanded, positions)
  assert.ok(main.y + main.height < related.y)
})
