import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'
import { buildUniverseModel } from '../src/lib/universeModel.ts'
import { buildReleaseGuide } from '../src/lib/universeProgression.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.window = { addEventListener() {}, removeEventListener() {} }
const require = createRequire(import.meta.url)
const sourceUrl = new URL('../src/components/UniverseCanvas.tsx', import.meta.url)
const source = (await readFile(sourceUrl, 'utf8'))
  .replace(/import \{[^}]+\} from '@xyflow\/react'/, "const BaseEdge = 'path', Handle = 'span', Panel = 'div', Position = {}, ReactFlow = 'ReactFlow'")
  .replace("import { motion, useReducedMotion } from 'motion/react'", "const motion = { div: 'div', span: 'span', path: 'path', circle: 'circle' }; const useReducedMotion = () => false")
  .replace("import { CanvasPointerContext, useCanvasParallax } from '../lib/useCanvasParallax'", "const useCanvasParallax = () => {}; const CanvasPointerContext = { Provider: 'CursorProvider' }")
  .replace("import CursorStars from './CursorStars'", "const CursorStars = 'CursorStars'")
  .replace("import PointerEdge from './PointerEdge'", "const PointerEdge = 'PointerEdge'")
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(name.startsWith('.') ? new URL(name + '.ts', sourceUrl).href : pathToFileURL(require.resolve(name)).href)}`)
const { default: UniverseCanvas } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('hover and keyboard focus preview the clicked route without moving worlds or navigating early', async () => {
  const media = ['a', 'b', 'c'].map((id, i) => ({ id, title: id, type: 'anime', format: 'TV', total_units: 12, release_date: { year: 2000 + i }, cover_url: null }))
  const universe = { root_id: 'a', media, relationships: [{ source: 'a', target: 'b', type: 'SEQUEL' }, { source: 'b', target: 'c', type: 'SEQUEL' }] }
  const model = buildUniverseModel(universe), guide = buildReleaseGuide(model, {})
  const selected = []
  const props = { universe, model, guide, focusedId: 'a', active: true, release: false, onFocus: m => selected.push(m.id), onRelease() {}, onExpand() {}, expanding: false, details: null }
  let renderer
  try {
    await act(async () => { renderer = create(createElement(UniverseCanvas, props)); await new Promise(resolve => setTimeout(resolve, 100)) })
    const flow = () => renderer.root.findByType('ReactFlow').props
    const edge = flow().edges.find(e => e.source === 'a' && e.target === 'b')
    const remoteEdge = flow().edges.find(e => e.source === 'b' && e.target === 'c')
    const geometry = flow().nodes.map(n => [n.id, n.position])
    const previews = () => flow().edges.filter(e => e.data.preview).map(e => e.id)
    await act(async () => flow().onEdgeMouseEnter({}, edge))
    assert.deepEqual(previews(), [edge.id])
    assert.equal(flow().nodes.find(n => n.id === 'b').data.preview, true)
    assert.deepEqual(flow().nodes.map(n => [n.id, n.position]), geometry)
    assert.deepEqual(selected, [])
    await act(async () => flow().onEdgeMouseLeave())
    assert.deepEqual(previews(), [])
    await act(async () => flow().onNodeMouseEnter({}, { id: 'b' }))
    assert.deepEqual(previews(), [edge.id])
    await act(async () => flow().onNodeMouseLeave())
    await act(async () => flow().nodes.find(n => n.id === 'b').data.onPreview('b'))
    assert.deepEqual(previews(), [edge.id])
    await act(async () => flow().onEdgeClick({}, edge))
    assert.deepEqual(selected, ['b']); assert.deepEqual(previews(), [])
    await act(async () => renderer.update(createElement(UniverseCanvas, { ...props, focusedId: 'b' })))
    await act(async () => flow().onEdgeMouseEnter({}, edge))
    assert.equal(flow().nodes.find(n => n.id === 'a').data.preview, true)
    await act(async () => flow().onEdgeClick({}, edge))
    assert.deepEqual(selected, ['b', 'a'])
    await act(async () => renderer.update(createElement(UniverseCanvas, props)))
    await act(async () => flow().onEdgeMouseEnter({}, remoteEdge))
    assert.equal(flow().nodes.find(n => n.id === 'c').data.preview, true)
    await act(async () => flow().onEdgeClick({}, remoteEdge))
    assert.deepEqual(selected, ['b', 'a', 'c'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('story details minimize and restore without moving the camera, and stay minimized across world selection', async () => {
  const media = ['a', 'b'].map(id => ({ id, title: id, type: 'anime', format: 'TV', total_units: 12, cover_url: null }))
  const universe = { root_id: 'a', media, relationships: [{ source: 'a', target: 'b', type: 'SEQUEL' }] }
  const model = buildUniverseModel(universe), guide = buildReleaseGuide(model, {})
  let cameraMoves = 0, selections = 0
  const props = { universe, model, guide, focusedId: 'a', active: true, release: false, onFocus: () => selections++,
    onRelease() {}, onExpand() {}, expanding: false, details: createElement('p', null, 'Story details') }
  let renderer
  try {
    await act(async () => { renderer = create(createElement(UniverseCanvas, props)); await new Promise(resolve => setTimeout(resolve, 100)) })
    const flow = () => renderer.root.findByType('ReactFlow').props
    const toggle = () => renderer.root.findByProps({ className: 'inspector-toggle' })
    const content = () => renderer.root.findByProps({ id: toggle().props['aria-controls'] })
    await act(async () => flow().onInit({ setViewport: () => cameraMoves++ }))
    const initialMoves = cameraMoves, initialNodes = flow().nodes, initialEdges = flow().edges
    assert.equal(toggle().props['aria-expanded'], true)
    assert.equal(content().props.hidden, false)
    await act(async () => toggle().props.onClick())
    assert.equal(toggle().props['aria-label'], 'Show details')
    assert.equal(toggle().props['aria-expanded'], false)
    assert.equal(content().props.hidden, true)
    assert.equal(cameraMoves, initialMoves); assert.equal(selections, 0)
    assert.equal(flow().nodes, initialNodes); assert.equal(flow().edges, initialEdges)
    await act(async () => renderer.update(createElement(UniverseCanvas, { ...props, focusedId: 'b', details: createElement('p', null, 'New story details') })))
    assert.equal(content().props.hidden, true)
    assert.equal(content().findByType('p').children[0], 'New story details')
    const selectedMoves = cameraMoves
    await act(async () => toggle().props.onClick())
    assert.equal(toggle().props['aria-label'], 'Minimize details')
    assert.equal(toggle().props['aria-expanded'], true)
    assert.equal(content().props.hidden, false)
    assert.equal(cameraMoves, selectedMoves); assert.equal(selections, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})
