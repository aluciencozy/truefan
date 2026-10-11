import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__glitterReduced = false
const require = createRequire(import.meta.url)
const source = (await readFile(new URL('../src/components/GlitterStars.tsx', import.meta.url), 'utf8'))
  .replace("import './GlitterStars.css'", '')
  .replace("import { useReducedMotion } from 'motion/react'", 'const useReducedMotion = () => globalThis.__glitterReduced')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
const { default: GlitterStars } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('one star flickers every 20 seconds, pauses in hidden tabs, and cleans up for reduced motion', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const previous = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle }
  const colors = { '--teal': '#94e2d5', '--peach': '#fab387', '--pink': '#f5c2e7', '--blue': '#89b4fa', '--yellow': '#f9e2af', '--mauve': '#cba6f7' }
  const flickers = []
  let cancellations = 0, renderer
  globalThis.window = { setInterval, clearInterval }
  globalThis.document = { hidden: false }
  globalThis.getComputedStyle = () => ({ getPropertyValue: name => colors[name] })
  const points = Array.from({ length: 120 }, () => ({ animate(keyframes, options) {
    flickers.push({ keyframes, options })
    return { cancel: () => cancellations++ }
  } }))
  try {
    await act(async () => { renderer = create(createElement(GlitterStars), { createNodeMock: () => ({ querySelectorAll: () => points }) }) })
    t.mock.timers.tick(19_999)
    assert.equal(flickers.length, 0)
    t.mock.timers.tick(1)
    assert.equal(flickers.length, 1)
    assert.equal(flickers[0].options.duration, 1800)
    assert.ok(Object.values(colors).includes(flickers[0].keyframes[1].background))
    globalThis.document.hidden = true
    t.mock.timers.tick(20_000)
    assert.equal(flickers.length, 1)
    globalThis.document.hidden = false
    t.mock.timers.tick(20_000)
    assert.equal(flickers.length, 2)
    globalThis.__glitterReduced = true
    await act(async () => renderer.update(createElement(GlitterStars)))
    assert.equal(cancellations, 1)
    t.mock.timers.tick(40_000)
    assert.equal(flickers.length, 2)
    globalThis.__glitterReduced = false
    await act(async () => renderer.update(createElement(GlitterStars)))
    t.mock.timers.tick(20_000)
    assert.equal(flickers.length, 3)
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(cancellations, 2)
    t.mock.timers.tick(40_000)
    assert.equal(flickers.length, 3)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    t.mock.timers.reset()
    Object.assign(globalThis, previous)
    globalThis.__glitterReduced = false
  }
})
