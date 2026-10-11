import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

test('production uses the website origin even with the old Railway env setting', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.__routingAuth = { token: async () => ({ data: { token: 'fixture.jwt' }, error: null }) }
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json({})
  }
  try {
    const source = (await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'))
      .replace("import { authClient } from './auth'", 'const authClient = globalThis.__routingAuth')
      .replace('import.meta.env.PROD', 'true')
      .replace('import.meta.env.VITE_API_URL', "'https://truefan-production.up.railway.app'")
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    const { api } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
    await api.health()
    await api.searchUniverses('Demon Slayer', true)
    await api.saveMediaState('anilist-2', { completed: true })
    await api.surprise()
    await api.surprise('anilist-21')
    assert.deepEqual(calls.map(call => call.url), [
      '/health', '/api/universes/search?q=Demon%20Slayer&discover=true', '/api/me/media-state/anilist-2',
      '/api/media/surprise', '/api/media/surprise?exclude=anilist-21',
    ])
    assert.equal(calls[3].options.headers.get('Authorization'), null)
    assert.equal(calls[2].options.method, 'PUT')
    assert.equal(calls[2].options.headers.get('Authorization'), 'Bearer fixture.jwt')
    assert.deepEqual(JSON.parse(calls[2].options.body), { completed: true })
  } finally {
    globalThis.fetch = originalFetch
    delete globalThis.__routingAuth
  }
})
