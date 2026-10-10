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
  .replace(/import (\w+) from '\.\/components\/[^']+'/g, (_, name) => name === 'AppNavbar' ? `const AppNavbar = props => createElement('AuthPanel', { onIdentity: props.onIdentity })` : name === 'UniverseCanvas' ? `const UniverseCanvas = props => createElement('UniverseCanvas', props, props.details)` : `const ${name} = '${name}'`)
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
    assert.equal(renderer.root.findByType('details').props.open, false)
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
      if (['loading', 'saving'].includes(scenario)) {
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
  let renderer
  try {
    await act(async () => { renderer = create(createElement(App)) })
    assert.equal(renderer.root.findByType('MediaControls').props.initialQuery, '')
    assert.equal(renderer.root.findAllByType('ProgressControl').length, 0)
    assert.equal(renderer.root.findByType('details').props.open, true)
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
