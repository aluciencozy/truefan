import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

test('universe expansion carries revision and selected root; authenticated bulk/flags never send ownership or watched units', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  let tokens = 0
  globalThis.__universeApiAuth = { token: async () => { tokens++; return { data: { token: 'fixture.jwt' }, error: null } } }
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    return Response.json(options.method === 'PUT' ? { media_id: 'anilist-2', progress: { unit: 7 }, completed: true, manual_unlocked: true } : [])
  }
  try {
    const source = (await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'))
      .replace("import { authClient } from './auth'", 'const authClient = globalThis.__universeApiAuth')
      .replace('import.meta.env.VITE_API_URL', "'http://api.example.test'")
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    const { api } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
    const controller = new AbortController()
    await api.expandUniverse('anilist-2', 9, controller.signal)
    assert.equal(calls[0].url, 'http://api.example.test/api/media/anilist-2/universe/expand')
    assert.deepEqual(JSON.parse(calls[0].options.body), { expected_revision: 9 })
    assert.equal(calls[0].options.signal, controller.signal); assert.equal(tokens, 0)
    await api.searchUniverses('Fate/Zero', false, controller.signal)
    await api.searchUniverses('Fate/Zero', true, controller.signal)
    assert.equal(calls[1].url, 'http://api.example.test/api/universes/search?q=Fate%2FZero&discover=false')
    assert.equal(calls[2].url, 'http://api.example.test/api/universes/search?q=Fate%2FZero&discover=true')
    assert.equal(calls[2].options.signal, controller.signal); assert.equal(tokens, 0)
    await api.mediaState(['anilist-2', 'anilist-4'], controller.signal)
    const bulk = new URL(calls[3].url)
    assert.deepEqual(bulk.searchParams.getAll('media_id'), ['anilist-2', 'anilist-4'])
    assert.equal(calls[3].options.headers.get('Authorization'), 'Bearer fixture.jwt')
    const state = await api.saveMediaState('anilist-2', { manual_unlocked: true })
    assert.deepEqual(JSON.parse(calls[4].options.body), { manual_unlocked: true })
    assert.equal(state.progress.unit, 7); assert.equal(state.completed, true)
    assert.equal(tokens, 2)
  } finally { globalThis.fetch = originalFetch; delete globalThis.__universeApiAuth }
})

test('merged franchises over 50 members load every owner state in deterministic bounded batches', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.__largeUniverseApiAuth = { token: async () => ({ data: { token: 'fixture.jwt' }, error: null }) }
  globalThis.fetch = async (url, options) => {
    const ids = new URL(url).searchParams.getAll('media_id')
    calls.push({ ids, signal: options.signal })
    assert.ok(ids.length >= 1 && ids.length <= 50)
    // Reversed completion order must not change combined ordering or lose IDs.
    await new Promise(resolve => setTimeout(resolve, ids[0] === 'anilist-000' ? 10 : 0))
    return Response.json(ids.map(media_id => ({ media_id, progress: null, completed: false, manual_unlocked: false })))
  }
  try {
    const source = (await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'))
      .replace("import { authClient } from './auth'", 'const authClient = globalThis.__largeUniverseApiAuth')
      .replace('import.meta.env.VITE_API_URL', "'http://api.example.test'")
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    const { api } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
    const ids = Array.from({ length: 123 }, (_, i) => `anilist-${String(i).padStart(3,'0')}`)
    const controller = new AbortController()
    const result = await api.mediaState([...ids].reverse().concat(ids[0]), controller.signal)
    assert.deepEqual(calls.map(c => c.ids.length), [50, 50, 23])
    assert.deepEqual(result.map(r => r.media_id), ids)
    assert.ok(calls.every(c => c.signal === controller.signal))
    assert.deepEqual(await api.mediaState([]), [])
    assert.equal(calls.length, 3)
  } finally { globalThis.fetch = originalFetch; delete globalThis.__largeUniverseApiAuth }
})

test('saving a rewound spoiler lens preserves watched units even before universe state is loaded', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.__progressApiAuth = { token: async () => ({ data: { token: 'fixture.jwt' }, error: null }) }
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (options.method !== 'PUT') return Response.json([{ media_id: 'anilist-2', progress: { unit: 12 }, completed: true, manual_unlocked: true }])
    const body = JSON.parse(options.body)
    assert.deepEqual(body, { unit: 12 })
    return Response.json({ media_id: 'anilist-2', progress: { unit: body.unit } })
  }
  try {
    const source = (await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'))
      .replace("import { authClient } from './auth'", 'const authClient = globalThis.__progressApiAuth')
      .replace('import.meta.env.VITE_API_URL', "'http://api.example.test'")
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    const { api } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
    assert.equal((await api.saveProgress('anilist-2', 2)).progress.unit, 12)
    assert.equal(requests.length, 2)
    assert.match(requests[0].url, /media-state/)
    assert.match(requests[1].url, /progress\/anilist-2$/)
  } finally { globalThis.fetch = originalFetch; delete globalThis.__progressApiAuth }
})
