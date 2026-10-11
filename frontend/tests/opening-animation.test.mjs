import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement, StrictMode } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
const source = (await readFile(new URL('../src/components/OpeningAnimation.tsx', import.meta.url), 'utf8'))
  .replace("import './OpeningAnimation.css'", '')
  .replace("import { useAnimate } from 'motion/react'", 'const useAnimate = () => globalThis.__openingAnimation')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
const { default: OpeningAnimation } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

async function setup(t, { target = true, broken = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.window = { innerHeight: 800, setTimeout, clearTimeout }
  const calls = []
  const stage = { offsetWidth: 240, style: {} }
  const matrix = { inverse() { return this }, multiply() { return this } }
  const path = { style: {}, getScreenCTM: () => matrix, getTotalLength: () => 100,
    getPointAtLength: distance => ({ x: 100 + distance, y: 200 - distance, matrixTransform() { return this } }) }
  const particle = { style: {}, setAttribute() {} }
  stage.querySelector = selector => selector === 'svg' ? { getScreenCTM: () => matrix }
    : selector.startsWith('.opening-arc') ? path : particle
  const destination = { left: 32, top: 24, width: 52, height: 52 }
  const frame = { left: 0, top: 0, width: 1200, height: 800 }
  const node = { querySelectorAll: () => [], querySelector: selector => selector === '.opening-logo' ? stage
    : selector === '.opening-position' ? { getBoundingClientRect: () => frame }
    : target ? { getBoundingClientRect: () => destination } : null }
  const scope = { current: null }
  const animate = (...args) => {
    if (broken) throw new Error('Animation unavailable')
    let resolve
    const control = new Promise(done => { resolve = done })
    Object.assign(control, { stop() { this.stopped = true }, stopped: false, resolve })
    calls.push({ args, control })
    return control
  }
  globalThis.__openingAnimation = [scope, animate]
  const tree = label => createElement(StrictMode, null, createElement(OpeningAnimation, null, createElement('main', null, label)))
  let renderer
  await act(async () => { renderer = create(tree('Home'), { createNodeMock: () => node }) })
  t.after(async () => { await act(async () => renderer.unmount()); t.mock.timers.reset() })
  return {
    renderer, calls, stage, destination, frame,
    content: () => renderer.root.findByProps({ className: 'opening-content' }),
    tick: async ms => { await act(async () => t.mock.timers.tick(ms)) },
    update: async label => { await act(async () => renderer.update(tree(label))) },
  }
}

test('StrictMode starts one live intro, releases interaction on landing, and does not replay on navigation', async t => {
  const app = await setup(t)
  assert.equal(app.renderer.root.findByType('main').children[0], 'Home')
  assert.equal(app.content().props.inert, true)
  assert.ok(app.calls.some(call => call.control.stopped))
  await app.tick(1400)
  const flights = app.calls.filter(call => call.args[0] === 0 && call.args[2].duration === 1.05)
  assert.equal(flights.length, 1)
  await act(async () => flights[0].control.resolve())
  assert.equal(app.content().props.inert, false)
  assert.equal(app.content().props['aria-hidden'], undefined)
  assert.equal(app.renderer.root.findAllByProps({ className: 'opening-overlay' }).length, 0)
  assert.ok(app.calls.every(call => call.control.stopped))
  const count = app.calls.length
  await app.update('Library')
  assert.equal(app.calls.length, count)
})

test('landing follows a resized viewport and the current navbar bounds', async t => {
  const app = await setup(t)
  await app.tick(1400)
  const flight = app.calls.find(call => call.args[0] === 0 && call.args[2].duration === 1.05)
  flight.args[2].onUpdate(.2)
  const early = app.stage.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)
  assert.ok(Number(early[1]) > 0 && Number(early[2]) > 0, 'momentum first pushes the logo right and down')
  const bank = Number(app.stage.style.transform.match(/rotate\(([-\d.]+)deg/)[1])
  assert.ok(bank > 60 && bank < 240, 'the star banks into the turn instead of staying upright')
  flight.args[2].onUpdate(.5)
  assert.match(app.stage.style.transform, /^translate3d\(/)
  Object.assign(app.frame, { width: 360, height: 720 })
  Object.assign(app.destination, { left: 20, top: 16 })
  flight.args[2].onUpdate(1)
  assert.match(app.stage.style.transform, /translate3d\(-134px, -318px, 0\)/)
  const finalAngle = Number(app.stage.style.transform.match(/rotate\(([-\d.]+)deg/)[1])
  assert.ok(Math.abs(finalAngle - 360) < .001, 'landing matches the static logo orientation')
  await app.tick(1600)
  assert.equal(app.content().props.inert, false, 'stalled animation must release the app by three seconds')
})

test('missing navbar fades away', async t => {
  const app = await setup(t, { target: false })
  await app.tick(1400)
  const fade = app.calls.find(call => call.args[0] === app.stage)
  assert.ok(fade)
  await act(async () => fade.control.resolve())
  assert.equal(app.content().props.inert, false)
})

test('animation startup errors release the page', async t => {
  const app = await setup(t, { broken: true })
  assert.equal(app.content().props.inert, false)
})
