import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement, StrictMode } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter, Route, useLocation, useNavigate } from 'react-router-dom'
import ts from 'typescript'
import { PageTransitionContext, pageDestination, usePageReady } from '../src/lib/pageTransition.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
const source = (await readFile(new URL('../src/components/PageTransition.tsx', import.meta.url), 'utf8'))
  .replace("import './PageTransition.css'", '')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(name.startsWith('.') ? new URL('../src/lib/pageTransition.ts', import.meta.url).href : pathToFileURL(require.resolve(name)).href)}`)
const { default: PageTransition } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

async function setup(t, { initial = '/', reduced = false, ready = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let motionReduced = reduced
  const motionListeners = new Set()
  const scrolls = [], focuses = [], reports = [], mounts = []
  globalThis.window = {
    scrollX: 0, scrollY: 0, history: { scrollRestoration: 'auto' },
    matchMedia: () => ({ get matches() { return motionReduced }, addEventListener: (_, callback) => motionListeners.add(callback), removeEventListener: (_, callback) => motionListeners.delete(callback) }),
    scrollTo({ left, top }) { this.scrollX = left; this.scrollY = top; scrolls.push([left, top]) },
  }
  let navigate, pageReady = ready, renderer
  function Controls() { navigate = useNavigate(); return null }
  function Page() {
    const location = useLocation()
    usePageReady(pageReady)
    return createElement(PageTransitionContext.Consumer, null, report => {
      reports.push(report)
      mounts.push(location.pathname + location.search)
      return createElement('main', { 'data-location': location.pathname + location.search }, location.pathname)
    })
  }
  const tree = () => createElement(StrictMode, null, createElement(MemoryRouter, { initialEntries: [initial] },
    createElement(Controls), createElement(PageTransition, null, createElement(Route, { path: '*', element: createElement(Page) }))))
  await act(async () => { renderer = create(tree(), { createNodeMock: element => element.props.className === 'page-transition-content' ? {
    querySelector: () => ({ setAttribute() {}, focus: options => focuses.push(options) }),
  } : null }) })
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(window.history.scrollRestoration, 'auto'); t.mock.timers.reset() })
  return {
    renderer, scrolls, focuses, reports, mounts,
    phase: () => renderer.root.findAll(node => node.type === 'div' && node.props.className?.startsWith('page-transition page-transition-'))[0].props.className.split('page-transition-')[1],
    location: () => renderer.root.findByType('main').props['data-location'],
    go: async to => { await act(async () => navigate(to)) },
    tick: async ms => { await act(async () => t.mock.timers.tick(ms)) },
    ready: async value => { pageReady = value; await act(async () => renderer.update(tree())) },
    motion: async value => { motionReduced = value; await act(async () => motionListeners.forEach(callback => callback())) },
  }
}

test('destination identity ignores dialog/search edits and equates story aliases', () => {
  const key = (pathname, search = '') => pageDestination({ pathname, search })
  assert.equal(key('/community', '?post=one'), key('/community', '?post=two'))
  assert.equal(key('/explore', '?q=one'), key('/explore', '?q=two'))
  assert.equal(key('/explore', '?media=one'), key('/explore', '?universe=one'))
  assert.notEqual(key('/explore', '?media=one'), key('/explore', '?media=two'))
})

test('initial render is immediate; outgoing hooks stay on departure; fetching starts before arrival', async t => {
  const app = await setup(t)
  assert.equal(app.phase(), 'idle')
  assert.equal(app.focuses.length, 0)
  window.scrollY = 400
  await app.go('/library')
  assert.equal(app.phase(), 'departing')
  assert.equal(app.location(), '/')
  assert.equal(app.renderer.root.findByProps({ className: 'page-transition-content' }).props.inert, true)
  await app.tick(139)
  assert.equal(app.location(), '/')
  await app.tick(1)
  assert.equal(app.location(), '/library')
  assert.equal(app.phase(), 'orbiting')
  assert.deepEqual(app.scrolls, [[0, 0]])
  await app.tick(290)
  assert.equal(app.phase(), 'arriving')
  await app.tick(220)
  assert.equal(app.phase(), 'idle')
  assert.equal(app.focuses.length, 1)
  assert.equal(app.renderer.root.findByProps({ className: 'page-transition-content' }).props.inert, false)
})

test('slow initial data holds the orbit then releases on readiness', async t => {
  const app = await setup(t, { ready: false })
  await app.go('/explore?media=one')
  await app.tick(140)
  await app.tick(290)
  assert.equal(app.phase(), 'orbiting')
  await app.tick(200)
  await app.ready(true)
  assert.equal(app.phase(), 'arriving')
  await app.tick(220)
  assert.equal(app.phase(), 'idle')
})

test('unresolved data arrives by 1.2 seconds and later readiness does not restart animation', async t => {
  const app = await setup(t, { ready: false })
  await app.go('/library')
  await app.tick(140)
  await app.tick(839)
  assert.equal(app.phase(), 'orbiting')
  await app.tick(1)
  assert.equal(app.phase(), 'arriving')
  await app.tick(220)
  assert.equal(app.phase(), 'idle')
  await app.ready(true)
  assert.equal(app.phase(), 'idle')
})

test('an error can report ready and release a held journey', async t => {
  const app = await setup(t, { ready: false })
  await app.go('/community')
  await app.tick(140)
  await app.tick(400)
  await act(async () => app.reports.at(-1)(true))
  assert.equal(app.phase(), 'arriving')
  await app.tick(220)
  assert.equal(app.phase(), 'idle')
})

test('rapid navigation replaces covered content and ignores old readiness and timers', async t => {
  const app = await setup(t, { ready: false })
  await app.go('/library')
  await app.tick(140)
  const stale = app.reports.at(-1)
  await app.go('/community')
  assert.equal(app.location(), '/community')
  assert.equal(app.phase(), 'orbiting')
  await act(async () => stale(true))
  await app.tick(430)
  assert.equal(app.phase(), 'orbiting')
  await app.ready(true)
  await app.tick(220)
  assert.equal(app.phase(), 'idle')
  await app.tick(2000)
  assert.equal(app.location(), '/community')
  assert.equal(app.phase(), 'idle')
})

test('navigation during departure mounts only the latest destination', async t => {
  const app = await setup(t)
  await app.go('/library')
  await app.tick(70)
  await app.go('/community')
  await app.tick(140)
  assert.equal(app.location(), '/community')
  assert.ok(!app.mounts.includes('/library'))
})

test('Back to a previous history entry rejects readiness from its earlier visit', async t => {
  const app = await setup(t, { initial: '/library' })
  const earlierVisit = app.reports.at(-1)
  await app.go('/community')
  await app.tick(140)
  await app.tick(290)
  await app.tick(220)
  await app.ready(false)
  await app.go(-1)
  await app.tick(140)
  await act(async () => earlierVisit(true))
  await app.tick(290)
  assert.equal(app.location(), '/library')
  assert.equal(app.phase(), 'orbiting')
})

test('dialog and search query edits preserve the page without motion; story links animate', async t => {
  const app = await setup(t, { initial: '/community' })
  await app.go('/community?post=one')
  assert.equal(app.phase(), 'idle')
  assert.equal(app.location(), '/community?post=one')
  assert.equal(app.focuses.length, 0)
  await app.go('/explore?media=one')
  await app.tick(140)
  await app.tick(290)
  await app.tick(220)
  await app.go('/explore?universe=one&q=hello')
  assert.equal(app.phase(), 'idle')
  await app.go('/explore?media=two')
  assert.equal(app.phase(), 'departing')
})

test('reduced motion mounts immediately without a hold or overlay', async t => {
  const app = await setup(t, { reduced: true, ready: false })
  await app.go('/library')
  assert.equal(app.location(), '/library')
  assert.equal(app.phase(), 'idle')
  assert.equal(app.renderer.root.findAllByProps({ className: 'page-transition-sky' }).length, 0)
  assert.equal(app.focuses.length, 1)
})

test('reduced-motion dialog query edits do not steal focus or reset scroll', async t => {
  const app = await setup(t, { initial: '/community', reduced: true })
  window.scrollY = 450
  await app.go('/community?post=one')
  assert.equal(app.location(), '/community?post=one')
  assert.equal(app.phase(), 'idle')
  assert.equal(app.focuses.length, 0)
  assert.equal(window.scrollY, 450)
})

test('enabling reduced motion during a journey cancels the hold and timers', async t => {
  const app = await setup(t, { ready: false })
  await app.go('/library')
  await app.tick(140)
  await app.motion(true)
  assert.equal(app.location(), '/library')
  assert.equal(app.phase(), 'idle')
  await app.tick(2000)
  assert.equal(app.phase(), 'idle')
})

test('Back and Forward restore saved scroll instead of resetting it', async t => {
  const app = await setup(t, { reduced: true })
  window.scrollY = 450
  await app.go('/library')
  window.scrollY = 800
  await app.go(-1)
  assert.equal(app.location(), '/')
  assert.equal(window.scrollY, 450)
  await app.go(1)
  assert.equal(app.location(), '/library')
  assert.equal(window.scrollY, 800)
})

test('Back waits for returning page data before restoring a scroll position', async t => {
  const app = await setup(t, { initial: '/community', reduced: true })
  window.scrollY = 450
  await app.go('/library')
  window.scrollY = 100
  await app.ready(false)
  await app.go(-1)
  assert.equal(app.location(), '/community')
  assert.equal(window.scrollY, 100)
  await app.ready(true)
  assert.equal(window.scrollY, 450)
})
