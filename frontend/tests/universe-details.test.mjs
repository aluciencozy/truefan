import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { buildUniverseModel } from '../src/lib/universeModel.ts'
import { buildReleaseGuide } from '../src/lib/universeProgression.ts'

const require = createRequire(import.meta.url)
const sourceUrl = new URL('../src/components/UniverseDetails.tsx', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
outputText = outputText.replace(/from "react\/jsx-runtime"/, `from ${JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)}`)
outputText = outputText.replace(/from '([^']+)'/g, (_, name) => `from ${JSON.stringify(new URL(name + '.ts', sourceUrl).href)}`)
const { default: Details } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const media = ['a', 'b'].map((id, index) => ({ id, title: `Work ${id}`, type: 'anime', progress_unit: 'episode', total_units: 12, total_units_known: true, description: 'SECRET STORY DETAIL', anilist_id: index + 1, has_prologue: false, cover_url: null, format: 'SECRET FORMAT', release_date: { year: 2000 + index, month: 1, day: 1 } }))
const universe = { root_id: 'b', media, relationships: [{ source: 'a', target: 'b', type: 'SEQUEL' }], truncated: false }
const model = buildUniverseModel(universe)
const callbacks = { onEnter: () => {}, onUnlock: () => {}, onComplete: () => {}, onFocus: () => {} }
function render(states) {
  return renderToStaticMarkup(createElement(Details, { media: media[1], universe, model, guide: buildReleaseGuide(model, states).b, state: states.b, release: true, busy: false, message: '', ...callbacks }))
}

test('Locked detail exposes title and exact relation evidence, with no entry, description, format, date or episode total', () => {
  const html = render({})
  assert.match(html, /Work b/); assert.match(html, /sequel/); assert.match(html, /Unlock anyway/)
  for (const unsafe of ['Enter World', 'SECRET STORY DETAIL', 'SECRET FORMAT', '2001-01-01', '12 episodes', 'I finished']) assert.ok(!html.includes(unsafe), unsafe)
})
test('manual unlock grants explicit entry but does not fabricate completion', () => {
  const html = render({ b: { media_id: 'b', progress: null, completed: false, manual_unlocked: true } })
  assert.match(html, /Enter World/); assert.match(html, /Available/); assert.match(html, /I finished this anime/)
  assert.ok(!html.includes('Unlock anyway')); assert.ok(!html.includes('>Completed<'))
})
test('confirmed completed media stays accessible and cannot be accidentally re-marked through this panel', () => {
  const html = render({ b: { media_id: 'b', progress: { unit: 3 }, completed: true, manual_unlocked: false } })
  assert.match(html, /Enter World/); assert.match(html, />Completed</)
  assert.ok(!html.includes('I finished this anime'))
  assert.match(html, /value="3"/)
})

test('available panel shows recorded progress and a metadata summary without provider plot text', () => {
  const html = render({ b: { media_id: 'b', progress: { unit: 7 }, completed: false, manual_unlocked: false } })
  assert.match(html, /7 episodes watched/)
  assert.match(html, /value="7"/)
  assert.match(html, /Explore its sequel connections/)
  assert.ok(!html.includes('SECRET STORY DETAIL'))
  assert.ok(!/Branch \d/.test(html))
})

test('explicit completion without recorded units never fabricates episode progress', () => {
  const html = render({ b: { media_id: 'b', progress: null, completed: true, manual_unlocked: false } })
  assert.match(html, />Completed</)
  assert.match(html, /value="0"/)
})
