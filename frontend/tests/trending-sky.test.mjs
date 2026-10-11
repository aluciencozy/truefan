import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import ts from 'typescript'
const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.document = {addEventListener() {}, removeEventListener() {}, activeElement: null}
function compile(source) {
  let {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}})
  outputText = outputText.replace(/from (["'])([^"']+)\1/g, (_, quote, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`)
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
}
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
globalThis.__constellation = await import(compile(await read('../src/lib/constellation.ts')))
const sky = await import(compile((await read('../src/lib/trendingSky.ts'))
  .replace("import { constellationLayout } from './constellation'", 'const {constellationLayout} = globalThis.__constellation').replace(/import type [^\n]+\n/, '')))
globalThis.__sky = sky
const source = (await read('../src/components/TrendingSky.tsx'))
  .replace("import { Link, useNavigate } from 'react-router-dom'", "const Link = 'a'; const useNavigate = () => globalThis.__navigate")
  .replace("import { motion, useReducedMotion } from 'motion/react'", "const motion = {path: 'path'}; const useReducedMotion = () => true")
  .replace("import { api } from '../lib/api'", 'const api = {}')
  .replace(/import \{ completionsLabel[^\n]+\n/, 'const {completionsLabel, constellationCaption, hashString, neighbourInDirection, seededRandom, skyLayout, starSubtitle, trendingLabel} = globalThis.__sky\n')
  .replace(/import type [^\n]+\n/g, '')
  .replace("import SurpriseLauncher from './SurprisePick'", "const SurpriseLauncher = 'SurpriseLauncher'")
  .replace("import './TrendingSky.css'", '')
const TrendingSky = (await import(compile(source))).default

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} !== ${expected}`)
const star = (id, completions, magnitude, over = {}) => ({media_id: id, title: `Title ${id}`, cover_url: null, format: 'TV', year: 2011, completions, magnitude, trending: false, trending_rank: null, ...over})
const constellation = (franchise, ids, over = {}) => ({franchise_id: franchise, title: `${franchise} Universe`, entry_media_id: `anilist-${ids[0]}`, score: ids.length * 10, trending_rank: null,
  stars: ids.map((id, index) => star(`anilist-${id}`, 20 - index * 4, 1 - index * .15)),
  links: ids.slice(1).map((id, index) => ({source: `anilist-${ids[index]}`, target: `anilist-${id}`, type: index % 2 ? 'INFERRED' : 'SEQUEL'})), ...over})
const many = count => Array.from({length: count}, (_, index) => constellation(`franchise-${index}`, [1, 2, 3, 4, 5].map(n => index * 10 + n)))

test('shapes are deterministic per franchise id and differ between franchises', () => {
  const region = {x: 40, y: 20, w: 330, h: 330}
  const a = constellation('fate', [1, 2, 3, 4, 5]), b = constellation('dragon-ball', [1, 2, 3, 4, 5])
  const first = sky.constellationShape(a, region), again = sky.constellationShape(structuredClone(a), region)
  assert.deepEqual(first, again)
  assert.notDeepEqual(first.stars.map(({x, y}) => [x, y]), sky.constellationShape(b, region).stars.map(({x, y}) => [x, y]))
  assert.deepEqual(sky.skyLayout(many(5), 1440), sky.skyLayout(many(5), 1440))
  assert.equal(sky.hashString('fate'), sky.hashString('fate')); assert.notEqual(sky.hashString('fate'), sky.hashString('Fate'))
})

test('stars stay inside their region and above the label strip, at every breakpoint', () => {
  for (const width of [375, 640, 800, 1024, 1440]) for (const count of [1, 2, 3, 4, 5, 8]) {
    const layout = sky.skyLayout(many(count), width, 520)
    assert.equal(layout.constellations.length, count)
    for (const item of layout.constellations) {
      assert.equal(item.stars.length, 5)
      for (const point of item.stars) {
        assert.ok(point.x - point.r >= item.region.x && point.x + point.r <= item.region.x + item.region.w, `x ${width}/${count}`)
        assert.ok(point.y - point.r >= item.region.y && point.y + point.r <= item.region.y + item.region.h - sky.LABEL_HEIGHT, `y ${width}/${count}`)
      }
      assert.ok(item.label.y >= item.region.y + item.region.h - sky.LABEL_HEIGHT && item.label.y + 40 <= item.region.y + item.region.h)
      assert.ok(item.region.x >= 0 && item.region.x + item.region.w <= width && item.region.y + item.region.h <= layout.height)
    }
  }
})

test('regions never overlap and stack in one column on phones', () => {
  for (const width of [375, 640, 900, 1280, 1440]) for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const {regions} = sky.skyRegions(count, width)
    for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i], b = regions[j]
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${width}/${count}: ${i} overlaps ${j}`)
    }
  }
  assert.equal(sky.skyRegions(5, 375).columns, 1); assert.equal(sky.skyRegions(5, 375).regions.every(region => region.x === 16), true)
  assert.equal(sky.skyRegions(5, 800).columns, 2); assert.equal(sky.skyRegions(5, 1440).columns, 3); assert.equal(sky.skyRegions(2, 1440).columns, 2)
})

test('five constellations fit without scrolling at 1440x900 and 1280x800 as a centred 3 + 2', () => {
  // Heights are what remains for the sky under the navbar, headings and footer at those screen sizes.
  for (const [width, available] of [[1440, 520], [1280, 420], [1280, 520], [1440, 640]]) {
    const layout = sky.skyLayout(many(5), width, available)
    assert.ok(layout.height <= available, `${width}x${available}: ${layout.height}`)
    assert.equal(layout.columns, 3)
    const rows = [...new Set(layout.constellations.map(item => item.region.y))]
    assert.equal(rows.length, 2); assert.deepEqual(layout.constellations.map(item => rows.indexOf(item.region.y)), [0, 0, 0, 1, 1])
    const [d, e] = layout.constellations.slice(3).map(item => item.region)
    near(d.x + d.w + 8, width / 2); near(e.x - 8, width / 2)  // the second row is centred as a pair
    for (const item of layout.constellations) {
      assert.ok(item.region.h >= sky.MIN_CELL_HEIGHT && item.region.h <= sky.MAX_CELL_HEIGHT)
      for (const point of item.stars) {
        assert.ok(point.y + point.r <= item.region.y + item.region.h - sky.LABEL_HEIGHT && point.y - point.r >= item.region.y)
        assert.ok(point.x - point.r >= item.region.x && point.x + point.r <= item.region.x + item.region.w)
      }
      for (let i = 0; i < item.stars.length; i++) for (let j = i + 1; j < item.stars.length; j++) {
        assert.ok(Math.hypot(item.stars[i].x - item.stars[j].x, item.stars[i].y - item.stars[j].y) >= item.stars[i].r + item.stars[j].r, 'cores touch')
      }
    }
  }
  // Cells grow with the space available but never past the cap, and never below a readable minimum.
  assert.equal(sky.skyRegions(5, 1440, 2000).regions[0].h, sky.MAX_CELL_HEIGHT)
  assert.equal(sky.skyRegions(5, 1440, 100).regions[0].h, sky.MIN_CELL_HEIGHT)
  assert.equal(sky.skyRegions(5, 1440).regions[0].h, sky.MAX_CELL_HEIGHT)
  // Phones still stack and scroll, whatever the height.
  const phone = sky.skyRegions(5, 375, 300)
  assert.equal(phone.columns, 1); assert.equal(phone.regions[0].h, 280); assert.ok(phone.height > 300)
})

test('stars never overlap each other and links reference existing stars', () => {
  for (const item of sky.skyLayout(many(5), 1440, 520).constellations) {
    const ids = new Set(item.stars.map(point => point.id))
    for (const link of item.links) { assert.ok(ids.has(link.source) && ids.has(link.target)); assert.equal(link.inferred, link.type === 'INFERRED') }
    for (let i = 0; i < item.stars.length; i++) for (let j = i + 1; j < item.stars.length; j++) {
      const a = item.stars[i], b = item.stars[j]
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, 'cores touch')
    }
  }
  const dangling = constellation('x', [1, 2, 3], {links: [{source: 'anilist-1', target: 'anilist-999', type: 'SEQUEL'}]})
  assert.deepEqual(sky.constellationShape(dangling, {x: 0, y: 0, w: 300, h: 300}).links, [])
})

test('magnitude drives radius and brightness within bounds', () => {
  assert.ok(sky.starRadius(1) > sky.starRadius(.25)); assert.ok(sky.starRadius(.25) > 0)
  assert.ok(sky.starOpacity(1) > sky.starOpacity(.25)); assert.equal(sky.starOpacity(1), 1); assert.ok(sky.starOpacity(0) >= .4)
  assert.ok(sky.starRadius(2) <= sky.starRadius(1)); assert.ok(sky.starRadius(.5, .85) < sky.starRadius(.5))
  const shape = sky.constellationShape(constellation('m', [1, 2, 3, 4]), {x: 0, y: 0, w: 320, h: 330})
  assert.ok(shape.stars[0].r > shape.stars[3].r)
})

test('arrow keys move to the nearest star in that direction', () => {
  const points = [{id: 'a', x: 0, y: 0}, {id: 'b', x: 100, y: 5}, {id: 'c', x: 40, y: 90}, {id: 'd', x: 220, y: 0}]
  assert.equal(sky.neighbourInDirection(points, 'a', 'ArrowRight'), 'b'); assert.equal(sky.neighbourInDirection(points, 'b', 'ArrowRight'), 'd')
  assert.equal(sky.neighbourInDirection(points, 'a', 'ArrowDown'), 'c'); assert.equal(sky.neighbourInDirection(points, 'c', 'ArrowUp'), 'a')
  assert.equal(sky.neighbourInDirection(points, 'a', 'ArrowLeft'), null); assert.equal(sky.neighbourInDirection(points, 'a', 'Tab'), null); assert.equal(sky.neighbourInDirection(points, 'zz', 'ArrowUp'), null)
})

test('labels use plain, singular-aware wording', () => {
  assert.equal(sky.completionsLabel(42), '42 completions this month'); assert.equal(sky.completionsLabel(1), '1 completion this month')
  assert.equal(sky.completionsLabel(0), '0 completions this month')
  assert.equal(sky.starSubtitle({format: 'TV_SHORT', year: 2011}), 'TV SHORT · 2011'); assert.equal(sky.starSubtitle({format: null, year: null}), '')
})

const text = node => typeof node === 'string' ? node : node?.children?.map(text).join(' ') ?? ''
async function render(service, fallback = 'FALLBACK') {
  const focused = []
  let renderer
  await act(async () => { renderer = create(createElement(TrendingSky, {service, fallback}), {createNodeMock: element => ({focus() { focused.push(element.props['aria-label']) }, contentRect: {}})}) })
  await act(async () => {})
  return {renderer, focused}
}
const data = (over = {}) => ({source: 'truefan_completions', window_days: 30, constellations: [constellation('fate', [1, 2, 3, 4]), constellation('dragon', [11, 12, 13])], ...over})
const stars = renderer => renderer.root.findAll(node => node.props.role === 'button' && node.type === 'g')

test('renders the heading, source note, labels, and focusable stars', async () => {
  const {renderer} = await render({trendingConstellations: async () => data()})
  const content = text(renderer.toJSON())
  assert.match(content, /Trending constellations/); assert.match(content, /What anime fans are watching right now, and the stories connected to them\./); assert.match(content, /Based on TrueFan completions this month/)
  assert.doesNotMatch(content, /sample activity/)
  assert.match(content, /fate Universe/); assert.match(content, /40 completions this month/)
  assert.equal(stars(renderer).length, 7)
  assert.ok(stars(renderer).every(node => node.props.tabIndex === 0 || node.props.tabIndex === -1))
  // Roving tabindex: Tab visits one star per constellation.
  assert.equal(stars(renderer).filter(node => node.props.tabIndex === 0).length, 2)
  assert.match(stars(renderer)[0].props['aria-label'], /Title anilist-1, TV · 2011, 20 completions this month/)
  assert.equal(renderer.root.findAll(node => node.type === 'a').map(node => node.props.to)[0], '/explore?media=anilist-1')
  assert.ok(renderer.root.findByType('SurpriseLauncher'))
  const live = await render({trendingConstellations: async () => data({source: 'anilist_trending'})})
  assert.doesNotMatch(text(live.renderer.toJSON()), /Based on TrueFan completions/)
})

test('clicking or pressing Enter on a star opens that work; arrows move focus within a constellation', async () => {
  const visited = []; globalThis.__navigate = to => visited.push(to)
  const {renderer, focused} = await render({trendingConstellations: async () => data()})
  const first = stars(renderer)[0]
  await act(async () => first.props.onClick()); assert.deepEqual(visited, ['/explore?media=anilist-1'])
  await act(async () => first.props.onKeyDown({key: 'Enter', preventDefault() {}})); assert.equal(visited.length, 2)
  await act(async () => first.props.onKeyDown({key: ' ', preventDefault() {}})); assert.equal(visited.at(-1), '/explore?media=anilist-1')
  let prevented = false
  const layout = sky.skyLayout(data().constellations, 1100).constellations[0]
  const key = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].find(candidate => sky.neighbourInDirection(layout.stars, 'anilist-1', candidate))
  await act(async () => first.props.onKeyDown({key, preventDefault() { prevented = true }}))
  assert.equal(prevented, true); assert.equal(focused.length, 1); assert.match(focused[0], /^Title anilist-\d+/)
  assert.ok(!focused[0].includes('anilist-1,') && !/anilist-1[1-3]/.test(focused[0]), 'focus stays in the same constellation')
})

test('hovering a star shows its card and dims the other constellations', async () => {
  const {renderer} = await render({trendingConstellations: async () => data()})
  const second = stars(renderer)[0]
  await act(async () => second.props.onPointerEnter())
  const card = renderer.root.findAll(node => node.props.role === 'tooltip')[0]
  const cardText = text({children: card.children})
  assert.match(cardText, /Title anilist-1/); assert.match(cardText, /TV · 2011/); assert.match(cardText, /20 completions this month/)
  const groups = renderer.root.findAll(node => /sky-constellation/.test(node.props.className ?? ''))
  assert.deepEqual(groups.map(node => /is-dim/.test(node.props.className)), [false, true])
  await act(async () => renderer.root.findAll(node => /sky-label/.test(node.props.className ?? '') && node.type === 'div')[1].props.onPointerEnter())
  assert.deepEqual(renderer.root.findAll(node => /sky-constellation/.test(node.props.className ?? '')).map(node => /is-dim/.test(node.props.className)), [true, false])
})

test('loading shows faint placeholder stars; errors and an empty sky fall back to the empty state', async () => {
  let release
  const slow = {trendingConstellations: () => new Promise(resolve => { release = resolve })}
  const {renderer} = await render(slow)
  assert.equal(renderer.root.findAll(node => node.props.className === 'sky-placeholder').length, 28)
  assert.equal(renderer.root.findAll(node => node.props.role === 'status').length > 0, true)
  await act(async () => release(data())); assert.equal(stars(renderer).length, 7)
  assert.equal(text((await render({trendingConstellations: async () => { throw new Error('503') }})).renderer.toJSON()), 'FALLBACK')
  assert.equal(text((await render({trendingConstellations: async () => data({constellations: []})})).renderer.toJSON()), 'FALLBACK')
})

// ---- AniList-driven sky: trending seeds -----------------------------------------------------------------------------

const seedStar = (id, rank, completions = 0) => star(`anilist-${id}`, completions, 1, {trending: true, trending_rank: rank})
const trendingData = () => ({source: 'anilist_trending', window_days: 30, constellations: [
  {franchise_id: 'trending-anilist-1', title: 'Show One Universe', entry_media_id: 'anilist-1', score: 14, trending_rank: 1,
   stars: [seedStar(1, 1, 9), star('anilist-2', 5, .6), seedStar(3, 4, 0), star('anilist-4', 0, .3)], links: [{source: 'anilist-1', target: 'anilist-2', type: 'SEQUEL'}, {source: 'anilist-1', target: 'anilist-3', type: 'INFERRED'}, {source: 'anilist-3', target: 'anilist-4', type: 'SEQUEL'}]},
  {franchise_id: 'trending-anilist-7', title: 'Show Seven Universe', entry_media_id: 'anilist-7', score: 0, trending_rank: 7,
   stars: [seedStar(7, 7), star('anilist-8', 0, .5), star('anilist-9', 0, .25)], links: [{source: 'anilist-7', target: 'anilist-8', type: 'SEQUEL'}, {source: 'anilist-7', target: 'anilist-9', type: 'SPIN_OFF'}]},
]})

test('captions lead with the trending rank and mention TrueFan completions only when there are some', () => {
  assert.equal(sky.trendingLabel(3), 'Trending #3')
  assert.equal(sky.constellationCaption(1, 14, true), 'Trending #1 · 14 TrueFan completions this month')
  assert.equal(sky.constellationCaption(7, 0, true), 'Trending #7'); assert.equal(sky.constellationCaption(1, 1, true), 'Trending #1 · 1 TrueFan completion this month')
  assert.equal(sky.constellationCaption(null, 40, false), '40 completions this month')
  assert.equal(sky.completionsLabel(5, true), '5 TrueFan completions this month')
})

test('trending seeds are marked, labelled and announced; related stars keep the plain look', async () => {
  const {renderer} = await render({trendingConstellations: async () => trendingData()})
  const content = text(renderer.toJSON())
  assert.match(content, /Show One Universe/); assert.match(content, /Trending #1 · 14 TrueFan completions this month/); assert.match(content, /Trending #7/)
  assert.doesNotMatch(content, /Based on TrueFan completions/); assert.doesNotMatch(content, /sample/)
  const all = stars(renderer)
  assert.deepEqual(all.map(node => /is-seed/.test(node.props.className)), [true, false, true, false, true, false, false])
  assert.equal(renderer.root.findAll(node => node.props.className === 'sky-seed-ring').length, 3)
  assert.match(all[0].props['aria-label'], /Title anilist-1, TV · 2011, Trending #1, 9 TrueFan completions this month/)
  assert.equal(all[2].props['aria-label'], 'Title anilist-3, TV · 2011, Trending #4')   // no completions: nothing said about them
  assert.equal(all[3].props['aria-label'], 'Title anilist-4, TV · 2011')
})

test('the hover card shows the trending rank for seeds and completions only above zero', async () => {
  const {renderer} = await render({trendingConstellations: async () => trendingData()})
  const card = async index => {
    await act(async () => stars(renderer)[index].props.onPointerEnter())
    return text({children: renderer.root.findAll(node => node.props.role === 'tooltip')[0].children})
  }
  const seedWithCompletions = await card(0)
  assert.match(seedWithCompletions, /Title anilist-1/); assert.match(seedWithCompletions, /Trending #1/); assert.match(seedWithCompletions, /9 TrueFan completions this month/)
  const seedWithout = await card(2)
  assert.match(seedWithout, /Trending #4/); assert.doesNotMatch(seedWithout, /completion/)
  const related = await card(1)
  assert.doesNotMatch(related, /Trending/); assert.match(related, /5 TrueFan completions this month/)
  assert.doesNotMatch(await card(3), /completion/)
})

test('eight-star constellations fit their cells and five merged or capped constellations still fit 1440x900 and 1280x800', () => {
  const eight = index => ({franchise_id: `trending-anilist-${index}`, title: `T${index}`, entry_media_id: `anilist-${index}1`, score: 0, trending_rank: index + 1,
    stars: Array.from({length: 8}, (_, n) => ({...star(`anilist-${index}${n + 1}`, 0, n === 0 ? 1 : .25 + n * .09), trending: n < 2, trending_rank: n < 2 ? index + 1 + n : null})),
    links: Array.from({length: 7}, (_, n) => ({source: `anilist-${index}1`, target: `anilist-${index}${n + 2}`, type: n % 3 ? 'SPIN_OFF' : 'SEQUEL'}))})
  for (const [width, available] of [[1440, 520], [1280, 420]]) {
    const layout = sky.skyLayout([0, 1, 2, 3, 4].map(eight), width, available)
    assert.ok(layout.height <= available)
    for (const item of layout.constellations) {
      assert.equal(item.stars.length, 8); assert.equal(item.links.length, 7)
      for (const point of item.stars) {
        assert.ok(point.x - point.r >= item.region.x && point.x + point.r <= item.region.x + item.region.w)
        assert.ok(point.y - point.r >= item.region.y && point.y + point.r <= item.region.y + item.region.h - sky.LABEL_HEIGHT)
      }
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) assert.ok(Math.hypot(item.stars[i].x - item.stars[j].x, item.stars[i].y - item.stars[j].y) >= item.stars[i].r + item.stars[j].r, `${width}: cores touch`)
    }
  }
})
