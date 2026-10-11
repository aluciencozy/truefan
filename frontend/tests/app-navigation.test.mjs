import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
const api = {}
globalThis.__navigationApi = api
globalThis.__navigationQuery = 'q=anime'
const sourceUrl = new URL('../src/App.tsx', import.meta.url)
const source = ("import { createElement } from 'react'\n" + await readFile(sourceUrl, 'utf8'))
  .replace("import { Link, useSearchParams } from 'react-router-dom'", "const Link = 'a'; const useSearchParams = () => [new URLSearchParams(globalThis.__navigationQuery)]")
  .replace(/import (\w+) from '\.\/components\/[^']+'/g, (_, name) => name === 'AppNavbar' ? `const AppNavbar = props => createElement('AuthPanel', { onIdentity: props.onIdentity })` : name === 'UniverseCanvas' ? `const UniverseCanvas = props => createElement('UniverseCanvas', props, props.details(props.onEnter))` : `const ${name} = '${name}'`)
  .replace("import { api } from './lib/api'", 'const api = globalThis.__navigationApi')
  .replace("import { libraryApi } from './lib/library'", 'const libraryApi = {}')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => {
  const url = name.startsWith('.') ? new URL(`${name}.ts`, sourceUrl).href : pathToFileURL(require.resolve(name)).href
  return `from ${JSON.stringify(url)}`
})
const { default: App } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const fixture = { id: 'lantern-harbor', title: 'Lantern Harbor', type: 'anime', progress_unit: 'episode', total_units: 3, anilist_id: null, has_prologue: false, description: '', cover_url: null, format: null }
const first = { ...fixture, id: 'anilist-1', title: 'First', anilist_id: 1, release_date: { year: 2000, month: 1, day: 1 } }
const sequel = { ...first, id: 'anilist-2', title: 'Sequel', anilist_id: 2, release_date: { year: 2001, month: 1, day: 1 } }
const universe = { root_id: first.id, media: [first, sequel], relationships: [{ source: first.id, target: sequel.id, type: 'SEQUEL' }], truncated: false }

for (const signedIn of [false, true]) test(`marking completed opens the final episode for ${signedIn ? 'signed-in users' : 'guests'}`, async () => {
  globalThis.__navigationQuery = `media=${first.id}`
  const media = { ...first, total_units_known: true }
  const graphCalls = []
  Object.assign(api, {
    media: async () => media, universe: async () => ({ ...universe, media: [media, sequel] }),
    mediaState: async () => [{ media_id: media.id, progress: { unit: 1 }, completed: false, manual_unlocked: true }],
    saveMediaState: async (id, flags) => {
      assert.equal(id, media.id); assert.deepEqual(flags, { completed: true })
      return { media_id: id, progress: { unit: media.total_units }, completed: true, manual_unlocked: true }
    },
    graph: async (id, unit) => { graphCalls.push(unit); return { media_id: id, progress: { unit }, entities: [], relationships: [], generation: null } },
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    const props = name => renderer.root.findByType(name).props
    if (signedIn) await act(async () => props('AuthPanel').onIdentity('account-1'))
    await act(async () => props('UniverseDetails').onComplete(media))
    assert.equal(props('UniverseDetails').state.progress.unit, media.total_units)
    assert.equal(props('UniverseCanvas').guide[media.id].status, 'completed')
    await act(async () => props('UniverseDetails').onEnter(media))
    assert.equal(props('ProgressControl').progress, media.total_units)
    assert.deepEqual(graphCalls, [media.total_units])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

test('changing progress clears portraits and selected details before the next graph arrives', async () => {
  globalThis.__navigationQuery = 'media=lantern-harbor'
  const pending = []
  const character = { id: 'mira', name: 'Mira', type: 'character', portrait_url: '/mira.jpg' }
  Object.assign(api, {
    media: async () => fixture,
    graph: async (id, unit, signal) => {
      if (unit === 1) return { media_id: id, progress: { unit }, entities: [character], relationships: [], generation: null }
      const response = Promise.withResolvers()
      pending.push({ response, signal, id, unit })
      return response.promise
    },
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    await act(async () => renderer.root.findByType('GraphCanvas').props.onSelect('mira'))
    assert.equal(renderer.root.findByType('EntityDetails').props.entity.portrait_url, '/mira.jpg')
    await act(async () => renderer.root.findByType('ProgressControl').props.onProgress(2))
    assert.equal(renderer.root.findAllByType('GraphCanvas').length, 0)
    assert.equal(renderer.root.findAllByType('EntityDetails').length, 0)
    await act(async () => renderer.root.findByType('ProgressControl').props.onProgress(0))
    assert.equal(pending[0].signal.aborted, true)
    await act(async () => pending[0].response.resolve({ media_id: fixture.id, progress: { unit: 2 }, entities: [character], relationships: [], generation: null }))
    assert.equal(renderer.root.findAllByType('GraphCanvas').length, 0)
    await act(async () => pending[1].response.resolve({ media_id: fixture.id, progress: { unit: 0 }, entities: [], relationships: [], generation: null }))
    assert.equal(renderer.root.findAllByType('EntityDetails').length, 0)
    assert.equal(renderer.root.findAllByType('GraphCanvas').length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

for (const parameter of ['media', 'universe']) test(`direct ${parameter} route opens its universe without a second search or character generation`, async () => {
  globalThis.__navigationQuery = `${parameter}=${sequel.id}`
  const calls = []
  Object.assign(api, {
    health: async () => ({}),
    media: async id => { calls.push(['media', id]); return sequel },
    universe: async id => { calls.push(['universe', id]); return { ...universe, root_id: id } },
    search: async () => { assert.fail('Direct navigation must not search again') },
    graph: async () => { assert.fail('Opening a universe must not load character facts') },
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    assert.deepEqual(calls, [['media', sequel.id], ['universe', sequel.id]])
    assert.equal(renderer.root.findByType('UniverseCanvas').props.universe.root_id, sequel.id)
    assert.deepEqual(renderer.root.findByType('h1').children, ['Undiscovered'])
    assert.equal(renderer.root.findByType('dialog').props.open, undefined)
    assert.equal(renderer.root.findByProps({ className: 'explorer-search' }).props['aria-label'], 'Find another story')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

for (const scenario of ['loading', 'failed', 'saving', 'ready', 'guest']) {
  test(`search enters Lantern Harbor while previous universe state is ${scenario}`, async () => {
    const state = Promise.withResolvers()
    const save = Promise.withResolvers()
    const graphCalls = []
    const universeCalls = []
    let stateSignal
    Object.assign(api, {
      media: async id => id === first.id ? first : fixture,
      universe: async id => { universeCalls.push(id); return universe },
      mediaState: async (ids, signal) => { if (ids.includes(fixture.id)) return []; stateSignal = signal; return state.promise },
      saveMediaState: async () => save.promise,
      graph: async (id, unit) => { graphCalls.push({ id, unit }); return { media_id: id, progress: { unit }, entities: [], relationships: [], generation: null } },
    })
    let renderer
    try {
      await act(async () => { renderer = create(createElement(App)) })
      const props = name => renderer.root.findByType(name).props
      if (scenario !== 'guest') await act(async () => props('AuthPanel').onIdentity('account-1'))
      await act(async () => { globalThis.__navigationQuery = `media=${first.id}`; renderer.update(createElement(App)) })
      if (scenario === 'failed') await act(async () => state.reject(new Error('Saved state unavailable')))
      if (scenario === 'saving' || scenario === 'ready') await act(async () => state.resolve([]))
      if (scenario === 'saving') await act(async () => props('UniverseDetails').onComplete(first))

      // A failed saved-state load uses main's guest-style entry at progress zero.
      if (scenario === 'loading') {
        assert.equal(renderer.root.findAllByType('UniverseCanvas').length, 0)
        assert.equal(graphCalls.length, 0)
      } else if (scenario === 'saving') {
        await act(async () => props('UniverseDetails').onEnter(first))
        assert.equal(graphCalls.length, 0)
      } else {
        assert.equal(props('UniverseCanvas').guide[sequel.id].status, 'locked')
        await act(async () => props('UniverseDetails').onEnter(sequel))
        assert.equal(graphCalls.length, 0)
        await act(async () => props('UniverseDetails').onEnter(first))
        assert.deepEqual(graphCalls, [{ id: first.id, unit: 0 }])
      }

      await act(async () => { globalThis.__navigationQuery = `media=${fixture.id}`; renderer.update(createElement(App)) })
      assert.deepEqual(graphCalls.at(-1), { id: fixture.id, unit: scenario === 'guest' ? 1 : 0 })
      assert.equal(props('ProgressControl').media.id, fixture.id)
      assert.equal(renderer.root.findAllByType('UniverseCanvas').length, 0)
      assert.deepEqual(universeCalls, [first.id])
      if (stateSignal) assert.equal(stateSignal.aborted, true)

      await act(async () => {
        state.resolve([])
        save.resolve({ media_id: first.id, progress: null, completed: true, manual_unlocked: false })
      })
      assert.equal(props('ProgressControl').media.id, fixture.id)
      assert.equal(renderer.root.findAllByType('UniverseCanvas').length, 0)
    } finally {
      if (renderer) await act(async () => renderer.unmount())
      globalThis.__navigationQuery = 'q=anime'
    }
  })
}


test('signed-in demo restores progress automatically before requesting character facts', async () => {
  globalThis.__navigationQuery = 'media=lantern-harbor'
  const saved = Promise.withResolvers()
  const graphCalls = []
  Object.assign(api, {
    media: async () => fixture, mediaState: async () => saved.promise,
    graph: async (id, unit) => { graphCalls.push(unit); return { media_id: id, progress: { unit }, entities: [], relationships: [], generation: null } },
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    graphCalls.length = 0
    await act(async () => renderer.root.findByType('AuthPanel').props.onIdentity('account-1'))
    assert.equal(renderer.root.findByType('ProgressControl').props.disabled, true)
    assert.deepEqual(graphCalls, [])
    await act(async () => saved.resolve([{ media_id: fixture.id, progress: { unit: 2 }, completed: false, manual_unlocked: false }]))
    assert.equal(renderer.root.findByType('ProgressControl').props.progress, 2)
    assert.deepEqual(graphCalls, [2])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

test('episode edits autosave in order, failures can retry, and old account responses are ignored', async () => {
  globalThis.__navigationQuery = 'media=lantern-harbor'
  const firstSave = Promise.withResolvers()
  const staleSave = Promise.withResolvers()
  const calls = []
  let fail = false
  Object.assign(api, {
    media: async () => fixture, mediaState: async () => [],
    graph: async (id, unit) => ({ media_id: id, progress: { unit }, entities: [], relationships: [], generation: null }),
    saveProgress: async (id, unit) => {
      calls.push(unit)
      if (calls.length === 1) return firstSave.promise
      if (fail) throw new Error('Offline')
      if (calls.length === 4) return staleSave.promise
      return { media_id: id, progress: { unit } }
    },
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    const props = name => renderer.root.findByType(name).props
    await act(async () => props('AuthPanel').onIdentity('account-1'))
    await act(async () => props('ProgressControl').onProgress(1))
    await act(async () => props('ProgressControl').onProgress(2))
    assert.deepEqual(calls, [1])
    assert.equal(props('ProgressControl').progress, 2)
    await act(async () => firstSave.resolve({ media_id: fixture.id, progress: { unit: 1 } }))
    assert.deepEqual(calls, [1, 2])
    assert.equal(props('ProgressControl').progress, 2)
    fail = true
    await act(async () => props('ProgressControl').onProgress(3))
    const retry = renderer.root.findAllByType('button').find(button => button.children.includes('Retry'))
    assert.ok(retry)
    fail = false
    await act(async () => retry.props.onClick())
    assert.deepEqual(calls, [1, 2, 3, 3])
    await act(async () => props('AuthPanel').onIdentity('account-2'))
    await act(async () => staleSave.resolve({ media_id: fixture.id, progress: { unit: 3 } }))
    assert.equal(props('ProgressControl').progress, 0)
    await act(async () => props('AuthPanel').onIdentity(null))
    await act(async () => props('ProgressControl').onProgress(2))
    assert.equal(calls.length, 4)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

for (const status of ['generating', 'not_generated']) test(`${status} character status sits in the canvas; guests never request generation`, async () => {
  globalThis.__navigationQuery = 'media=lantern-harbor'
  Object.assign(api, {
    media: async () => fixture,
    graph: async (id, unit) => ({ media_id: id, progress: { unit }, entities: [], relationships: [], generation: { status } }),
    generate: async () => assert.fail('Guests must not request authenticated generation'),
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    const message = renderer.root.findByProps({ className: 'empty celestial character-status' })
    assert.equal(message.props.role, 'status')
    let ancestor = message.parent
    while (ancestor && ancestor.props.className !== 'graph-stage') ancestor = ancestor.parent
    assert.ok(ancestor)
    const heading = renderer.root.findByProps({ className: 'graph-heading' })
    assert.equal(heading.findAll(node => node.props.role === 'status').length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})


test('explorer without a story offers search without loading the development fixture', async () => {
  globalThis.__navigationQuery = ''
  Object.assign(api, {
    health: async () => ({}),
    search: async () => assert.fail('An empty explorer must not load the development fixture'),
    media: async () => assert.fail('An empty explorer must not select media'),
    graph: async () => assert.fail('An empty explorer must not load character facts'),
  })
  let focused = false
  const dialog = {
    open: false,
    showModal() { this.open = true },
    close() { this.open = false },
    querySelector: () => ({ focus() { focused = true } }),
  }
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App), { createNodeMock: element => element.type === 'dialog' ? dialog : null }) })
    assert.equal(renderer.root.findByType('MediaControls').props.initialQuery, '')
    assert.equal(renderer.root.findAllByType('ProgressControl').length, 0)
    assert.equal(dialog.open, false)
    await act(async () => renderer.root.findByProps({ className: 'explorer-search' }).props.onClick())
    assert.equal(dialog.open, true)
    assert.equal(focused, true)
    const backdropClick = renderer.root.findByType('dialog').props.onClick
    await act(async () => backdropClick({ target: {}, currentTarget: dialog }))
    assert.equal(dialog.open, true)
    await act(async () => backdropClick({ target: dialog, currentTarget: dialog }))
    assert.equal(dialog.open, false)
    await act(async () => renderer.root.findByProps({ className: 'explorer-search' }).props.onClick())
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Close story search' }).props.onClick())
    assert.equal(dialog.open, false)
    assert.equal(renderer.root.findAllByType('GraphCanvas').length, 0)
    assert.ok(!JSON.stringify(renderer.toJSON()).includes('Lantern Harbor'))
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

test('switching stories cancels an old media load and ignores its late response', async () => {
  globalThis.__navigationQuery = `media=${first.id}`
  const pending = Promise.withResolvers()
  let oldSignal
  const calls = []
  Object.assign(api, {
    health: async () => ({}),
    media: async (id, signal) => {
      if (id === first.id) { oldSignal = signal; return pending.promise }
      return sequel
    },
    universe: async id => { calls.push(id); return { ...universe, root_id: id } },
    search: async () => assert.fail('Story selection must not use the old search'),
    graph: async () => assert.fail('Story selection must not load character facts'),
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    await act(async () => { globalThis.__navigationQuery = `media=${sequel.id}`; renderer.update(createElement(App)) })
    assert.equal(oldSignal.aborted, true)
    await act(async () => pending.resolve(first))
    assert.deepEqual(calls, [sequel.id])
    assert.equal(renderer.root.findByType('UniverseCanvas').props.universe.root_id, sequel.id)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

const deepMedia = { ...first, total_units: 12, total_units_known: true }
async function openDeepLink(query, { signedIn = false, saved = null } = {}) {
  globalThis.__navigationQuery = query
  const calls = { graph: [], universe: 0, saved: [] }
  Object.assign(api, {
    media: async () => deepMedia,
    universe: async () => { calls.universe++; return { ...universe, media: [deepMedia, sequel] } },
    mediaState: async () => saved === null ? [] : [{ media_id: deepMedia.id, progress: { unit: saved }, completed: false, manual_unlocked: false }],
    saveProgress: async (id, unit) => { calls.saved.push(unit); return { media_id: id, progress: { unit } } },
    graph: async (id, unit) => { calls.graph.push(unit); return { media_id: id, progress: { unit }, entities: [], relationships: [], generation: null } },
  })
  let renderer
  await act(async () => { renderer = create(createElement(App)) })
  if (signedIn) await act(async () => renderer.root.findByType('AuthPanel').props.onIdentity('account-1'))
  await act(async () => {})
  return { renderer, calls, props: name => renderer.root.findByType(name).props }
}
const closeDeepLink = async renderer => { await act(async () => renderer.unmount()); globalThis.__navigationQuery = 'q=anime' }

test('view=characters&progress=1 lands a guest on a non-empty episode-1 graph, skipping the universe map, with the explainer', async () => {
  const { renderer, calls, props } = await openDeepLink(`media=${first.id}&progress=1&view=characters&from=surprise`)
  try {
    assert.equal(calls.universe, 0)
    assert.equal(props('ProgressControl').progress, 1)
    assert.deepEqual(calls.graph, [1])
    assert.equal(renderer.root.findAllByType('SurpriseTip').length, 1)
  } finally { await closeDeepLink(renderer) }
})

test('deep-link progress is clamped to the media and invalid values are ignored', async () => {
  let { renderer, calls, props } = await openDeepLink(`media=${first.id}&progress=99&view=characters`)
  try { assert.equal(props('ProgressControl').progress, 12); assert.deepEqual(calls.graph, [12]); assert.equal(renderer.root.findAllByType('SurpriseTip').length, 0) }
  finally { await closeDeepLink(renderer) }
  ;({ renderer, calls, props } = await openDeepLink(`media=${first.id}&progress=-2&view=characters`))
  try { assert.equal(props('ProgressControl').progress, 0); assert.deepEqual(calls.graph, [0]) } finally { await closeDeepLink(renderer) }
})

test('without view=characters a progress param still opens the universe map as before', async () => {
  const { renderer, calls } = await openDeepLink(`media=${first.id}&progress=2`)
  try { assert.equal(calls.universe, 1); assert.equal(renderer.root.findAllByType('ProgressControl').length, 0) } finally { await closeDeepLink(renderer) }
})

test('a signed-in deep link overrides saved progress for this visit and never saves it', async () => {
  const { renderer, calls, props } = await openDeepLink(`media=${first.id}&progress=2&view=characters`, { signedIn: true, saved: 5 })
  try {
    assert.equal(props('ProgressControl').progress, 2)
    assert.equal(calls.graph.at(-1), 2); assert.ok(!calls.graph.includes(5) && !calls.graph.includes(0))
    assert.deepEqual(calls.saved, [])
    // A user's own change is saved and replaces the override.
    await act(async () => props('ProgressControl').onProgress(3)); await act(async () => {})
    assert.deepEqual(calls.saved, [3]); assert.equal(props('ProgressControl').progress, 3)
  } finally { await closeDeepLink(renderer) }
})

const third = { ...sequel, id: 'anilist-3', title: 'Third', anilist_id: 3, release_date: { year: 2002, month: 1, day: 1 } }
const chain = { ...universe, media: [first, sequel, third], relationships: [...universe.relationships, { source: sequel.id, target: third.id, type: 'SEQUEL' }] }

test('later-season search starts at the beginning and Start here preserves locked ancestor history', async () => {
  globalThis.__navigationQuery = `media=${third.id}`
  Object.assign(api, { media: async () => third, universe: async () => ({ ...chain, root_id: third.id }) })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    const canvas = () => renderer.root.findByType('UniverseCanvas').props
    assert.equal(canvas().focusedId, first.id)
    assert.equal(canvas().guide[third.id].visible, false)
    const start = renderer.root.findAllByType('button').find(b => b.children.includes('Start here instead · searched entry'))
    assert.ok(start)
    await act(async () => start.props.onClick())
    assert.equal(canvas().focusedId, third.id)
    assert.equal(canvas().guide[third.id].status, 'available')
    assert.equal(canvas().guide[sequel.id].status, 'locked')
    assert.equal(canvas().guide[first.id].status, 'available')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})

test('failed completion keeps the frontier locked; saved-state loading and account switching hide stale maps', async () => {
  globalThis.__navigationQuery = `media=${first.id}`
  const saved = Promise.withResolvers()
  let account = 0
  Object.assign(api, {
    media: async () => first, universe: async () => chain,
    mediaState: async () => ++account === 1 ? saved.promise : [],
    saveMediaState: async () => { throw new Error('Offline') },
  })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    const canvas = () => renderer.root.findByType('UniverseCanvas').props
    await act(async () => renderer.root.findByType('AuthPanel').props.onIdentity('account-one'))
    assert.equal(renderer.root.findAllByType('UniverseCanvas').length, 0)
    await act(async () => saved.resolve([{ media_id: third.id, progress: { unit: 3 }, completed: false, manual_unlocked: false }]))
    assert.equal(canvas().guide[third.id].visible, true)
    await act(async () => renderer.root.findByType('AuthPanel').props.onIdentity('account-two'))
    assert.equal(canvas().guide[third.id].visible, false)
    assert.equal(canvas().focusedId, first.id)
    await act(async () => renderer.root.findByType('UniverseDetails').props.onComplete(first))
    assert.equal(canvas().guide[sequel.id].status, 'locked')
    assert.equal(canvas().guide[third.id].visible, false)
    assert.equal(renderer.root.findByType('UniverseDetails').props.message, 'Offline')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__navigationQuery = 'q=anime'
  }
})
