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
globalThis.__homeCoverApi = api
const source = (await readFile(new URL('../src/components/HomePage.tsx', import.meta.url), 'utf8'))
  .replace("import { motion, useReducedMotion } from 'motion/react'", "const motion = { section: 'section' }; const useReducedMotion = () => true")
  .replace("import AppNavbar from './AppNavbar'", 'const AppNavbar = () => null')
  .replace("import { api } from '../lib/api'", 'const api = globalThis.__homeCoverApi')
  .replace("import UniverseSearch from './UniverseSearch'", "const UniverseSearch = 'UniverseSearch'")
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
const Home = (await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))).default
const nodes = renderer => renderer.root.findAllByProps({ className: 'home-node' })
const covers = renderer => nodes(renderer).flatMap(node => node.findAllByType('img'))

async function mount(t) {
  let renderer
  await act(async () => { renderer = create(createElement(Home)) })
  t.after(async () => { await act(async () => renderer.unmount()) })
  return renderer
}

test('homepage loads trending covers in rank order, keeps circular slots, and hides failed images', async t => {
  const pending = Promise.withResolvers()
  let signal
  api.trendingCovers = value => { signal = value; return pending.promise }
  const renderer = await mount(t)
  assert.equal(nodes(renderer).length, 16)
  assert.equal(covers(renderer).length, 0)
  const result = Array.from({ length: 16 }, (_, id) => ({ id: id + 1, cover_url: `https://s4.anilist.co/${id + 1}.jpg` }))
  await act(async () => pending.resolve(result))
  assert.deepEqual(covers(renderer).map(image => image.props.src), result.map(cover => cover.cover_url))
  assert.equal(renderer.root.findByProps({ className: 'home-graph' }).props['aria-hidden'], 'true')
  assert.ok(covers(renderer).every(image => image.props.alt === '' && image.props.width === image.props.height))
  const image = { style: {} }
  await act(async () => covers(renderer)[0].props.onError({ currentTarget: image }))
  assert.equal(image.style.visibility, 'hidden')
  await act(async () => renderer.unmount())
  assert.equal(signal.aborted, true)
})

test('provider failure keeps neutral slots and search available', async t => {
  api.trendingCovers = async () => { throw new Error('Provider offline') }
  const renderer = await mount(t)
  assert.equal(nodes(renderer).length, 16)
  assert.equal(covers(renderer).length, 0)
  assert.equal(renderer.root.findAllByType('UniverseSearch').length, 1)
})

test('unmount cancels the cover request and ignores a late response', async t => {
  const pending = Promise.withResolvers()
  let signal
  api.trendingCovers = value => { signal = value; return pending.promise }
  const renderer = await mount(t)
  await act(async () => renderer.unmount())
  assert.equal(signal.aborted, true)
  await act(async () => pending.resolve([{ id: 1, cover_url: 'https://s4.anilist.co/1.jpg' }]))
  assert.equal(renderer.toJSON(), null)
})

test('cover API uses the public endpoint with an abort signal and no authentication', async t => {
  const signal = new AbortController().signal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://api.example.test/api/media/trending')
    assert.equal(options.signal, signal)
    assert.equal(options.headers.has('Authorization'), false)
    return Response.json([{ id: 1, cover_url: 'https://s4.anilist.co/1.jpg' }])
  })
  const source = (await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'))
    .replace("import { authClient } from './auth'", 'const authClient = null')
    .replace('import.meta.env.VITE_API_URL', "'http://api.example.test'")
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  const { api } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
  assert.deepEqual(await api.trendingCovers(signal), [{ id: 1, cover_url: 'https://s4.anilist.co/1.jpg' }])
})
