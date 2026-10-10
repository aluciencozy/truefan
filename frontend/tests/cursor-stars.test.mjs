import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__starsReduced = false
const require = createRequire(import.meta.url)
const source = (await readFile(new URL('../src/components/CursorStars.tsx', import.meta.url), 'utf8'))
  .replace("import { useReducedMotion } from 'motion/react'", 'const useReducedMotion = () => globalThis.__starsReduced')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
const { default: CursorStars } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('global trail uses viewport coordinates, stays bounded, and cleans up for reduced motion', async () => {
  const listeners = new Map(), windowListeners = new Map(), sparks = []
  const stars = Array.from({ length: 10 }, () => ({
    style: {}, animations: [],
    getAnimations() { return this.animations },
    animate(keyframes, options) {
      sparks.push({ keyframes, options })
      this.animations = [{ cancel: () => { this.animations = [] } }]
    },
  }))
  const oldDocument = globalThis.document, oldWindow = globalThis.window
  globalThis.document = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
  }
  globalThis.window = {
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: name => windowListeners.delete(name),
  }
  const move = overrides => listeners.get('pointermove')({ pointerType: 'mouse', buttons: 0,
    clientX: 500, clientY: 300, timeStamp: 100, ...overrides })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(CursorStars), {
      createNodeMock: element => element.type === 'div' ? { querySelectorAll: () => stars } : null,
    }) })
    assert.equal(renderer.root.findByType('div').props['aria-hidden'], 'true')
    assert.equal(renderer.root.findAllByType('i').length, 10)
    move({})
    assert.equal(sparks.length, 1)
    assert.ok(Math.abs(parseFloat(stars[0].style.left) - 500) <= 38)
    assert.ok(Math.abs(parseFloat(stars[0].style.top) - 300) <= 38)
    move({ timeStamp: 120 }); assert.equal(sparks.length, 1)
    for (let i = 1; i <= 25; i++) move({ timeStamp: 100 + i * 90 })
    assert.equal(sparks.length, 26)
    assert.ok(stars.every(star => star.animations.length <= 1))
    assert.ok(sparks.every(spark => spark.options.duration >= 750 && spark.options.duration <= 1200))
    assert.ok(sparks.every(spark => spark.keyframes[0].opacity === 0 && spark.keyframes.at(-1).opacity === 0))
    for (const reset of [() => listeners.get('pointerleave')(), () => listeners.get('pointerdown')(),
      () => windowListeners.get('blur')(), () => move({ buttons: 1 }), () => move({ pointerType: 'touch' })]) {
      move({})
      reset()
      assert.ok(stars.every(star => star.animations.length === 0))
    }
    globalThis.__starsReduced = true
    await act(async () => renderer.update(createElement(CursorStars)))
    assert.equal(listeners.size, 0)
    assert.equal(windowListeners.size, 0)
    globalThis.__starsReduced = false
    await act(async () => renderer.update(createElement(CursorStars)))
    assert.equal(listeners.size, 3)
    assert.equal(windowListeners.size, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__starsReduced = false
    globalThis.document = oldDocument
    globalThis.window = oldWindow
  }
  assert.equal(listeners.size, 0)
  assert.equal(windowListeners.size, 0)
  assert.ok(stars.every(star => star.animations.length === 0))
})
