import { useState } from 'react'
import type { FormEvent } from 'react'
import { authClient } from '../lib/auth'
import { api } from '../lib/api'

export default function AuthPanel() {
  if (!authClient) return <p className="account-note">Guest demo. Configure Neon Auth to enable accounts.</p>
  return <ConfiguredAuth />
}

function ConfiguredAuth() {
  const client = authClient!
  const session = client.useSession()
  const [signUp, setSignUp] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setMessage('')
    try {
      const credentials = { email: String(data.get('email')), password: String(data.get('password')) }
      const result = signUp
        ? await client.signUp.email({ ...credentials, name: String(data.get('name')) })
        : await client.signIn.email(credentials)
      if (result.error) throw new Error(result.error.message || 'Authentication failed.')
      setMessage(signUp ? 'Account created. If email verification is enabled, check your inbox before signing in.' : 'Signed in.')
      await client.getSession()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Authentication failed.') }
    finally { setBusy(false) }
  }

  async function accountAction(action: 'check' | 'out') {
    setBusy(true); setMessage('')
    try {
      if (action === 'out') {
        const result = await client.signOut()
        if (result.error) throw new Error(result.error.message || 'Sign out failed.')
      } else {
        const user = await api.me()
        setMessage(`Backend verified your identity: ${user.id}`)
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Account request failed.') }
    finally { setBusy(false) }
  }

  return <details className="account-panel"><summary>Account{session.data ? `: ${session.data.user.name}` : ''}</summary>
    {session.isPending ? <p>Checking session…</p> : session.error ? <p role="alert">Session check failed. Check the Neon Auth URL and try reloading.</p> : session.data ? <div className="flex flex-wrap gap-3 mt-3">
      <button disabled={busy} onClick={() => void accountAction('check')}>Verify API session</button>
      <button disabled={busy} onClick={() => void accountAction('out')}>Sign out</button>
    </div> : <form onSubmit={submit} className="auth-form mt-3">
      {signUp ? <label>Name<input name="name" required autoComplete="name" /></label> : null}
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required minLength={8} autoComplete={signUp ? 'new-password' : 'current-password'} /></label>
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : signUp ? 'Create account' : 'Sign in'}</button>
      <button type="button" disabled={busy} onClick={() => { setSignUp(!signUp); setMessage('') }}>{signUp ? 'Use an existing account' : 'Create an account'}</button>
    </form>}
    <p role="status">{message}</p>
  </details>
}
