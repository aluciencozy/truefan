import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cursorBend } from '../src/lib/cursorBend.ts'

test('bending keeps endpoints anchored, attracts toward the cursor, and fades outside its neighborhood', () => {
  const source = { x: 0, y: 0 }, target = { x: 400, y: 0 }
  const straight = cursorBend(source, target, null)
  assert.equal(straight.path, 'M 0,0 Q 200,0 400,0')
  for (const y of [-60, 60]) {
    const bent = cursorBend(source, target, { x: 200, y })
    assert.ok(bent.path.startsWith('M 0,0 Q '))
    assert.ok(bent.path.endsWith(' 400,0'))
    assert.ok(bent.labelY * y > 0)
    assert.equal(bent.labelX, 200)
  }
  assert.deepEqual(cursorBend(source, target, { x: 200, y: 180 }), straight)
  assert.deepEqual(cursorBend(source, target, { x: -100, y: 20 }), straight)
  assert.deepEqual(cursorBend(source, target, { x: 0, y: 20 }), straight)
})

test('bend remains within 10 screen pixels across zoom levels and cannot produce NaN for coincident endpoints', () => {
  for (const zoom of [.01, .5, 1, 1.8]) {
    for (let distance = -179; distance < 180; distance += 5) {
      const source = { x: 0, y: 0 }, target = { x: 400 / zoom, y: 200 / zoom }
      const bent = cursorBend(source, target, { x: 200 / zoom, y: (100 + distance) / zoom }, zoom)
      const offset = Math.hypot(bent.labelX - 200 / zoom, bent.labelY - 100 / zoom) * zoom
      assert.ok(offset <= 10 + 1e-10)
    }
  }
  assert.equal(cursorBend({ x: 12, y: 12 }, { x: 12, y: 12 }, { x: 20, y: 30 }).path, 'M 12,12 Q 12,12 12,12')
  assert.equal(cursorBend({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 }, 0).labelY, 0)
})
