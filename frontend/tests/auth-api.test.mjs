import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { createAuthClient } from '@neondatabase/neon-js/auth'
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters'

test('cached Neon session still requests a JWT before calling a private API', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  let rejectToken = false
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input.toString())
    const headers = new Headers(init.headers)
    requests.push({ url, headers, credentials: init.credentials })
    if (url.pathname.endsWith('/get-session')) {
      return Response.json({
        session: { id: 'session', userId: 'user-a', token: 'opaque-session-id',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        user: { id: 'user-a', name: 'Test User', email: 'test@example.test' },
      })
    }
    if (url.pathname.endsWith('/token')) {
      return rejectToken
        ? Response.json({ message: 'Unauthorized' }, { status: 401 })
        : Response.json({ token: 'fixture.jwt.value' })
    }
    assert.equal(url.href, 'http://api.example.test/api/me')
    assert.equal(headers.get('Authorization'), 'Bearer fixture.jwt.value')
    return Response.json({ id: 'user-a' })
  }
  try {
    globalThis.__authApiTestClient = createAuthClient('https://auth.example.test/neondb/auth', {
      adapter: BetterAuthReactAdapter({ fetchOptions: { credentials: 'include' } }),
    })
    await globalThis.__authApiTestClient.getSession()
    // Exercise the real API source with the installed SDK and isolated HTTP fixtures.
    const source = (await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'))
      .replace("import { authClient } from './auth'", 'const authClient = globalThis.__authApiTestClient')
      .replace('import.meta.env.PROD', 'false')
      .replace('import.meta.env.VITE_API_URL', "'http://api.example.test'")
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    const { api } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
    assert.deepEqual(await api.me(), { id: 'user-a' })
    assert.deepEqual(requests.map(({ url }) => url.pathname),
      ['/neondb/auth/get-session', '/neondb/auth/token', '/api/me'])
    assert.equal(requests[1].credentials, 'include')
    assert.equal(requests[1].headers.has('X-Force-Fetch'), false)
    rejectToken = true
    await assert.rejects(api.me(), /Unauthorized/)
    assert.equal(requests.at(-1).url.pathname, '/neondb/auth/token')
    assert.equal(requests.filter(({ url }) => url.pathname === '/api/me').length, 1)
  } finally {
    globalThis.fetch = originalFetch
    delete globalThis.__authApiTestClient
  }
})
