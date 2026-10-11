import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
const require = createRequire(import.meta.url)
const source = (await readFile(new URL('../src/components/Constellation.tsx', import.meta.url), 'utf8'))
  .replace(/import \{[^}]+\} from '@xyflow\/react'/, `const Controls = 'Controls', Handle = 'Handle', Position = {}, ReactFlow = 'ReactFlow', ReactFlowProvider = 'Provider'; const useReactFlow = () => ({}), useStore = () => 0, useNodesInitialized = () => false`)
  .replace("import { useReducedMotion } from 'motion/react'", 'const useReducedMotion = () => true')
  .replace("import { canvasLimits } from '../lib/canvasLimits'", 'const canvasLimits = () => ({ minZoom: .1, extent: [[0, 0], [1000, 1000]] })')
  .replace("import { CanvasPointerContext, useCanvasParallax } from '../lib/useCanvasParallax'", "const CanvasPointerContext = { Provider: 'CursorProvider' }, useCanvasParallax = () => null")
  .replace("import CharacterPortrait from './CharacterPortrait'", "const CharacterPortrait = 'Portrait'")
  .replace("import PointerEdge from './PointerEdge'", "const PointerEdge = 'Edge'")
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
const { default: Constellation } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('connection hover highlights both endpoints without selecting or moving them and clears when facts disappear', async () => {
  const nodes = ['a', 'b', 'c'].map(id => ({ id, position: { x: 0, y: 0 }, data: { label: id, subtitle: 'character' } }))
  const edges = [{ id: 'ab', source: 'a', target: 'b' }]
  let selections = 0, renderer
  const props = { nodes, edges, selectedId: 'c', onSelect: () => selections++, label: 'Test graph' }
  try {
    await act(async () => { renderer = create(createElement(Constellation, props)) })
    const flow = () => renderer.root.findByType('ReactFlow').props
    const previews = () => flow().nodes.filter(node => node.data.preview).map(node => node.id)
    await act(async () => flow().onEdgeMouseEnter({}, edges[0]))
    assert.deepEqual(previews(), ['a', 'b'])
    assert.equal(flow().nodes.find(node => node.id === 'c').data.active, true)
    assert.deepEqual(flow().nodes.map(node => node.position), nodes.map(node => node.position))
    assert.equal(selections, 0)
    await act(async () => flow().onEdgeMouseLeave())
    assert.deepEqual(previews(), [])
    await act(async () => flow().onEdgeMouseEnter({}, edges[0]))
    await act(async () => renderer.update(createElement(Constellation, { ...props, edges: [] })))
    assert.deepEqual(previews(), [])
  } finally { if (renderer) await act(async () => renderer.unmount()) }
})
