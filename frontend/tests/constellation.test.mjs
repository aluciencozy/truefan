import assert from 'node:assert/strict'
import { test } from 'node:test'
import { constellationLayout } from '../src/lib/constellation.ts'
import { canvasLimits } from '../src/lib/canvasLimits.ts'

test('character layout places disconnected nodes and cycles without overlaps or phantom endpoints', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const links = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }, { source: 'a', target: 'missing' }]
  const positions = constellationLayout(ids, links)
  assert.deepEqual([...positions.keys()].sort(), ids)
  assert.deepEqual(positions, constellationLayout(ids, links))
  const points = [...positions.values()]
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    assert.ok(Math.abs(points[i].x - points[j].x) >= 170 || Math.abs(points[i].y - points[j].y) >= 160)
  }
  assert.equal(constellationLayout([], []).size, 0)
})

test('canvas limits fit the complete graph at mobile and desktop widths and bound the world', () => {
  for (const width of [390, 1440]) for (const points of [[], [{ x: 0, y: 0 }], [{ x: -800, y: -500 }, { x: 3400, y: 2200 }]]) {
    const { minZoom, extent } = canvasLimits(points, 176, 174, width, 650)
    assert.ok(minZoom > 0 && minZoom <= 1)
    assert.ok(extent.flat().every(Number.isFinite))
    for (const point of points) {
      assert.ok(point.x >= extent[0][0] && point.x + 176 <= extent[1][0])
      assert.ok(point.y >= extent[0][1] && point.y + 174 <= extent[1][1])
    }
    const graphWidth = Math.max(0, ...points.map(p => p.x)) + 176 - Math.min(0, ...points.map(p => p.x))
    assert.ok(graphWidth * minZoom < width)
    // Bounds stay tight to the graph: a modest pad, not a near-infinite world.
    assert.ok(extent[1][0] - (Math.max(0, ...points.map(p => p.x)) + 176) <= 300)
    assert.ok(extent[1][1] - (Math.max(0, ...points.map(p => p.y)) + 174) <= 250)
  }
})
