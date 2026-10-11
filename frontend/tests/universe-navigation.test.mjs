import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectedNeighbors, connectionDestination, directionalNeighbor, focusViewport } from '../src/lib/universeNavigation.ts'

const positions = { home: { x: 400, y: 400 }, left: { x: 100, y: 400 }, right: { x: 700, y: 400 }, up: { x: 400, y: 100 }, down: { x: 400, y: 700 }, diagonal: { x: 650, y: 650 } }
const links = [
  { source: 'left', target: 'home' }, { source: 'home', target: 'right' },
  { source: 'home', target: 'up' }, { source: 'down', target: 'home' },
  { source: 'home', target: 'down' }, { source: 'home', target: 'home' },
  { source: 'home', target: 'diagonal' }, { source: 'other', target: 'disconnected' },
]
test('hover previews and edge clicks use the same destination in either direction and in overview', () => {
  const link = { source: 'home', target: 'right' }
  assert.equal(connectionDestination(link, 'home'), 'right')
  assert.equal(connectionDestination(link, 'right'), 'home')
  assert.equal(connectionDestination(link, 'other'), 'right')
})

test('navigation follows connected neighbors in either direction, deduplicating reciprocal and self links', () => {
  const neighbors = connectedNeighbors({ links }, 'home')
  assert.deepEqual(neighbors, ['left', 'right', 'up', 'down', 'diagonal'])
  for (const [expected, direction] of [['left', { x: -1, y: 0 }], ['right', { x: 1, y: 0 }], ['up', { x: 0, y: -1 }], ['down', { x: 0, y: 1 }]]) {
    assert.equal(directionalNeighbor('home', neighbors, positions, direction), expected)
  }
  assert.equal(directionalNeighbor('home', ['right'], positions, { x: -1, y: 0 }), undefined)
  assert.equal(directionalNeighbor('home', ['missing'], positions, { x: 1, y: 0 }), undefined)
})
test('focus camera anchors artwork in the dedicated graph area on desktop and mobile', () => {
  for (const [width, height, horizontal, vertical] of [[1280, 720, .5, .43], [390, 500, .5, .43]]) {
    const view = focusViewport(positions.home, width, height)
    assert.equal(view.x + (positions.home.x + 88) * view.zoom, width * horizontal)
    assert.equal(view.y + (positions.home.y + 50) * view.zoom, height * vertical)
    assert.ok(view.zoom >= .95 && view.zoom <= 1.25)
  }
})

test('focus zoom shrinks for short canvases while keeping the selected world anchored', () => {
  const short = focusViewport(positions.home, 900, 250)
  const tall = focusViewport(positions.home, 900, 600)
  assert.ok(short.zoom < tall.zoom)
  assert.equal(short.x + (positions.home.x + 88) * short.zoom, 450)
  assert.equal(short.y + (positions.home.y + 50) * short.zoom, 250 * .43)
})
