import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__parallaxReduced = false
const require = createRequire(import.meta.url)
const source = ("import { useRef } from 'react'\n" + await readFile(new URL('../src/lib/useCanvasParallax.ts', import.meta.url), 'utf8'))
  .replace("import { useMotionValue, useReducedMotion } from 'motion/react'", `
    const useReducedMotion = () => globalThis.__parallaxReduced
    const useMotionValue = initial => useRef({ value: initial, set(value) { this.value = value }, get() { return this.value } }).current
  `)
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
outputText = outputText.replaceAll("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
const { useCanvasParallax } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

test('cursor-follow looks toward the mouse, scales within limits, and holds worlds still for selection', async () => {
  const listeners = new Map(), values = new Map()
  const previousComputedStyle = globalThis.getComputedStyle
  let displayedOffset
  globalThis.getComputedStyle = () => ({ translate: displayedOffset ?? [...values.values()].join(' ') })
  let width = 1000, height = 600
  const container = { current: {
    style: { setProperty: (name, value) => values.set(name, value) },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    querySelectorAll: () => [],
    querySelector: () => ({}),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
  } }
  function Canvas() { useCanvasParallax(container, true, true); return null }
  const offset = () => [values.get('--parallax-x'), values.get('--parallax-y')]
  const move = overrides => listeners.get('pointermove')({ pointerType: 'mouse', buttons: 0,
    clientX: width, clientY: height, target: { closest: () => null }, ...overrides })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(Canvas)) })
    move({}); assert.deepEqual(offset(), ['-180px', '-108px'])
    move({ clientX: 0, clientY: 0 }); assert.deepEqual(offset(), ['180px', '108px'])
    move({ clientX: width / 2, clientY: height / 2 }); assert.deepEqual(offset(), ['0px', '0px'])
    width = 2000; height = 1200
    move({ clientX: 9000, clientY: -9000 }); assert.deepEqual(offset(), ['-240px', '160px'])
    for (const selector of ['.react-flow__node-destination', '.react-flow__edge']) {
      move({ target: { closest: selectors => selectors.includes(selector) ? {} : null } })
      assert.deepEqual(offset(), ['-240px', '160px'])
    }
    displayedOffset = '-120px 80px'
    listeners.get('pointerdown')()
    move({ buttons: 1 }); assert.deepEqual(offset(), ['-120px', '80px'])
    displayedOffset = '-60px'
    listeners.get('pointerdown')(); assert.deepEqual(offset(), ['-60px', '0px'])
    displayedOffset = undefined
    listeners.get('pointerleave')(); assert.deepEqual(offset(), ['0px', '0px'])
    move({}); move({ target: { closest: selectors => selectors.includes('.react-flow__panel') ? {} : null } })
    assert.deepEqual(offset(), ['0px', '0px'])
    width = 400; height = 300
    move({}); assert.deepEqual(offset(), ['-72px', '-54px'])
    move({ pointerType: 'touch', buttons: 1 }); assert.deepEqual(offset(), ['0px', '0px'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.getComputedStyle = previousComputedStyle
  }
  assert.equal(listeners.size, 0)
  assert.deepEqual(offset(), ['0px', '0px'])
})

test('mouse effects stay bounded, reset on leave/drag/controls, and disable for touch or reduced motion', async () => {
  const listeners = new Map(), values = new Map()
  const sparks = []
  const stars = Array.from({ length: 10 }, () => ({
    style: {}, animations: [],
    getAnimations() { return this.animations },
    animate(keyframes, options) {
      sparks.push({ keyframes, options })
      this.animations = [{ cancel: () => { this.animations = [] } }]
    },
  }))
  const container = { current: {
    style: { setProperty: (name, value) => values.set(name, value) },
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 600 }),
    querySelectorAll: () => stars,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
  } }
  let pointer
  function Canvas({ active }) { pointer = useCanvasParallax(container, active); return null }
  const offset = () => [values.get('--parallax-x'), values.get('--parallax-y')]
  const move = overrides => listeners.get('pointermove')({ pointerType: 'mouse', buttons: 0,
    clientX: 1100, clientY: 650, timeStamp: 100, target: { closest: () => null }, ...overrides })
  let renderer
  try {
    await act(async () => { renderer = create(createElement(Canvas, { active: true })) })
    move({}); assert.deepEqual(offset(), ['12px', '9px'])
    assert.deepEqual(pointer.get(), { x: 1100, y: 650 })
    assert.equal(sparks.length, 1)
    move({ timeStamp: 120 }); assert.equal(sparks.length, 1)
    for (let i = 1; i <= 25; i++) move({ timeStamp: 100 + i * 90 })
    assert.equal(sparks.length, 26)
    assert.ok(stars.every(star => star.animations.length <= 1))
    assert.ok(sparks.every(spark => spark.options.duration >= 750 && spark.options.duration <= 1200))
    assert.ok(sparks.every(spark => spark.keyframes[0].opacity === 0 && spark.keyframes.at(-1).opacity === 0))
    move({ clientX: 9000, clientY: -9000 }); assert.deepEqual(offset(), ['12px', '-9px'])
    move({ clientX: 600, clientY: 350 }); assert.deepEqual(offset(), ['0px', '0px'])
    move({}); listeners.get('pointerleave')(); assert.deepEqual(offset(), ['0px', '0px'])
    assert.equal(pointer.get(), null)
    assert.ok(stars.every(star => star.animations.length === 0))
    move({}); listeners.get('pointerdown')(); assert.deepEqual(offset(), ['0px', '0px'])
    move({ buttons: 1 }); assert.deepEqual(offset(), ['0px', '0px'])
    move({ pointerType: 'touch' }); assert.deepEqual(offset(), ['0px', '0px'])
    move({ target: { closest: () => ({}) } }); assert.deepEqual(offset(), ['0px', '0px'])
    move({})
    await act(async () => renderer.update(createElement(Canvas, { active: false })))
    assert.equal(listeners.size, 0); assert.deepEqual(offset(), ['0px', '0px'])
    globalThis.__parallaxReduced = true
    await act(async () => renderer.update(createElement(Canvas, { active: true })))
    assert.equal(listeners.size, 0)
    globalThis.__parallaxReduced = false
    await act(async () => renderer.update(createElement(Canvas, { active: true })))
    assert.equal(listeners.size, 3)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    globalThis.__parallaxReduced = false
  }
  assert.equal(listeners.size, 0)
  assert.equal(pointer.get(), null)
})
