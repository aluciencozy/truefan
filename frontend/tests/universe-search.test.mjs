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
const api = { trendingCovers: async () => [] }
const routes = []
globalThis.__searchApi = api
globalThis.__searchNavigate = route => routes.push(route)

async function loadComponent(name, replace) {
  const url = new URL(`../src/components/${name}.tsx`, import.meta.url)
  const source = replace(await readFile(url, 'utf8'))
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, module) => `from ${JSON.stringify(pathToFileURL(require.resolve(module)).href)}`)
  return (await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))).default
}

const Search = await loadComponent('UniverseSearch', source => source
  .replace("import { useNavigate } from 'react-router-dom'", 'const useNavigate = () => globalThis.__searchNavigate')
  .replace("import { api } from '../lib/api'", 'const api = globalThis.__searchApi'))
globalThis.__sharedSearch = Search
const Home = await loadComponent('HomePage', source => source
  .replace("import { api } from '../lib/api'", 'const api = globalThis.__searchApi')
  .replace("import { motion, useReducedMotion } from 'motion/react'", "const motion = { section: 'section' }; const useReducedMotion = () => true")
  .replace("import AppNavbar from './AppNavbar'", 'const AppNavbar = () => null')
  .replace("import GlitterStars from './GlitterStars'", 'const GlitterStars = () => null')
  .replace("import UniverseSearch from './UniverseSearch'", 'const UniverseSearch = globalThis.__sharedSearch')
  .replace("import SurpriseLauncher from './SurprisePick'", "const SurpriseLauncher = () => null"))
const Controls = await loadComponent('MediaControls', source => source
  .replace("import UniverseSearch from './UniverseSearch'", 'const UniverseSearch = globalThis.__sharedSearch')
  .replace("import SurpriseLauncher from './SurprisePick'", "const SurpriseLauncher = () => null"))
const suggestion = { franchise_id: 'fate', title: 'Fate Universe', entry_media_id: 'anilist-100', cover_url: '/cover.png' }

async function mount(t, Component = Search, props = {}) {
  routes.length = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let renderer
  await act(async () => { renderer = create(createElement(Component, props)) })
  t.after(async () => { await act(async () => renderer.unmount()) })
  await act(async () => renderer.root.findByProps({ className: 'home-search-box' }).props.onFocus())
  return renderer
}
async function type(renderer, query) {
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: query } }))
}
async function submit(renderer) {
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
}

for (const [name, Component, props] of [['homepage', Home, {}], ['Find another story', Controls, { initialQuery: '' }]]) {
  test(`${name} uses the same debounced universe suggestions and direct story navigation`, async t => {
    const calls = []
    api.searchUniverses = async (query, discover) => { calls.push([query, discover]); return { results: [suggestion], auto_open: false } }
    const renderer = await mount(t, Component, props)
    await type(renderer, ' Fate/Zero ')
    await act(async () => t.mock.timers.tick(249))
    assert.deepEqual(calls, [])
    await act(async () => t.mock.timers.tick(1))
    assert.deepEqual(calls, [['Fate/Zero', false]])
    const result = renderer.root.findByType('button')
    assert.equal(result.findByType('small').children[0], 'Connected stories')
    await act(async () => result.props.onClick())
    assert.deepEqual(routes, ['/explore?media=anilist-100'])
  })
}

test('Enter discovers explicitly, cancels the suggestion timer, and opens an unambiguous result', async t => {
  const calls = []
  api.searchUniverses = async (query, discover) => { calls.push([query, discover]); return { results: [suggestion], auto_open: true } }
  const renderer = await mount(t)
  await type(renderer, 'Fate')
  await submit(renderer)
  await act(async () => t.mock.timers.tick(250))
  assert.deepEqual(calls, [['Fate', true]])
  assert.deepEqual(routes, ['/explore?media=anilist-100'])
})

test('changing or clearing a query cancels pending searches and ignores late suggestions', async t => {
  const pending = []
  api.searchUniverses = (query, discover, signal) => {
    const response = Promise.withResolvers()
    pending.push({ signal, response, query, discover })
    return response.promise
  }
  const renderer = await mount(t)
  await type(renderer, 'Fate')
  await act(async () => t.mock.timers.tick(250))
  await type(renderer, 'Steins')
  assert.equal(pending[0].signal.aborted, true)
  await act(async () => t.mock.timers.tick(250))
  await act(async () => pending[1].response.resolve({ results: [{ ...suggestion, title: 'Steins Universe' }], auto_open: false }))
  await act(async () => pending[0].response.resolve({ results: [suggestion], auto_open: false }))
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Steins Universe'))
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('Fate Universe'))
  await type(renderer, '')
  assert.equal(pending[1].signal.aborted, true)
  assert.equal(renderer.root.findAllByProps({ className: 'home-suggestions' }).length, 0)
  assert.deepEqual(routes, [])
})

test('ambiguous discovery and provider errors stay inline, with discovery available to retry', async t => {
  api.searchUniverses = async () => ({ results: [suggestion, { ...suggestion, franchise_id: 'other', title: 'Other universe' }], auto_open: false })
  const renderer = await mount(t)
  await type(renderer, 'Fate')
  await submit(renderer)
  assert.deepEqual(routes, [])
  assert.equal(renderer.root.findAllByType('button').length, 2)
  assert.match(renderer.root.findByProps({ role: 'status' }).children[0], /Choose a universe/)
  api.searchUniverses = async () => { throw new Error('Provider unavailable') }
  await type(renderer, 'Unknown story')
  await submit(renderer)
  assert.equal(renderer.root.findByProps({ role: 'status' }).children[0], 'Provider unavailable')
  assert.equal(renderer.root.findAllByType('button').length, 1)
  const calls = []
  api.searchUniverses = async (query, discover) => { calls.push([query, discover]); return { results: [], auto_open: false } }
  await act(async () => renderer.root.findByType('button').props.onClick())
  assert.deepEqual(calls, [['Unknown story', true]])
  assert.match(renderer.root.findByProps({ role: 'status' }).children[0], /No universe found/)
})

test('empty searches do not navigate to or load the demo', async t => {
  api.searchUniverses = async () => assert.fail('Empty searches must not make a request')
  const renderer = await mount(t)
  await type(renderer, '   ')
  await submit(renderer)
  await act(async () => t.mock.timers.tick(250))
  assert.deepEqual(routes, [])
})
