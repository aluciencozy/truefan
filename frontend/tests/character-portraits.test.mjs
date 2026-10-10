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
async function loadComponent(name, substitutions = {}) {
  let source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8')
  for (const [before, after] of Object.entries(substitutions)) source = source.replace(before, after)
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, module) => `from ${JSON.stringify(pathToFileURL(require.resolve(module)).href)}`)
  return (await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))).default
}
const Portrait = await loadComponent('CharacterPortrait')
globalThis.__testPortrait = Portrait
const Details = await loadComponent('EntityDetails', { "import CharacterPortrait from './CharacterPortrait'": 'const CharacterPortrait = globalThis.__testPortrait' })
const GraphCanvas = await loadComponent('GraphCanvas', {
  "import Constellation, { type StarNode } from './Constellation'": "const Constellation = 'constellation'",
  "import { constellationLayout } from '../lib/constellation'": 'const constellationLayout = ids => new Map(ids.map(id => [id, { x: 0, y: 0 }]))',
})

test('portraits load lazily, fall back on errors, and recover for a new source', async () => {
  let renderer
  try {
    await act(async () => { renderer = create(createElement(Portrait, { name: 'Rin Tohsaka', src: '/rin.jpg' })) })
    const image = renderer.root.findByType('img')
    assert.equal(image.props.loading, 'lazy')
    assert.equal(image.props.decoding, 'async')
    await act(async () => image.props.onError())
    assert.equal(renderer.root.findByType('span').children.join(''), 'RT')
    await act(async () => renderer.update(createElement(Portrait, { name: 'Saber', src: '/saber.jpg' })))
    assert.equal(renderer.root.findByType('img').props.src, '/saber.jpg')
    await act(async () => renderer.update(createElement(Portrait, { name: 'Unknown' })))
    assert.equal(renderer.root.findAllByType('img').length, 0)
  } finally { if (renderer) await act(async () => renderer.unmount()) }
})

test('graph uses medium portraits and details use large portraits without renaming characters', async () => {
  const entity = { id: 'saber', name: 'Saber', type: 'character', description: 'Known fact', revealed_at: { unit: 1 }, provenance: { source: 'Test', verified: true }, portrait_url: '/medium.jpg', portrait_large_url: '/large.jpg' }
  const graph = { entities: [entity], relationships: [] }
  let canvas, details
  try {
    await act(async () => { canvas = create(createElement(GraphCanvas, { graph, onSelect: () => {}, selectedId: null })) })
    const nodes = canvas.root.findByType('constellation').props.nodes
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].data.portraitUrl, '/medium.jpg')
    await act(async () => { details = create(createElement(Details, { entity, graph, media: { title: 'Fate', progress_unit: 'episode' }, onClose: () => {}, onSelect: () => {} })) })
    assert.equal(details.root.findByType('img').props.src, '/large.jpg')
    assert.equal(details.root.findByType('img').props.loading, 'eager')
    assert.equal(details.root.findByType('h2').children.join(''), 'Saber')
  } finally {
    if (canvas) await act(async () => canvas.unmount())
    if (details) await act(async () => details.unmount())
  }
})
