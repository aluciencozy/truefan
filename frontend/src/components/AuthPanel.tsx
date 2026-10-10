import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { api } from '../lib/api'
import type { Media } from '../lib/types'

interface Props {
  media: Media | null
  progress: number
  onProgress: (unit: number) => void
}

export default function AuthPanel(props: Props) {
  if (!authClient) return <p className="account-note">Guest demo. Configure Neon Auth to enable accounts.</p>
  return <ConfiguredAuth {...props} />
}

function ConfiguredAuth({ media, progress, onProgress }: Props) {
  const client = authClient!
  const session = client.useSession()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function accountAction(action: 'check' | 'save' | 'load') {
    setBusy(true); setMessage('')
    try {
      if (action === 'save' && media) {
        await api.saveProgress(media.id, progress)
        setMessage(`Saved ${media.progress_unit} ${progress}.`)
      } else if (action === 'load' && media) {
        const saved = await api.progress(media.id)
        if (saved) {
          onProgress(saved.progress.unit)
          setMessage(`Retrieved ${media.progress_unit} ${saved.progress.unit}.`)
        } else setMessage('No saved progress for this story yet.')
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
      <button disabled={busy || !media} onClick={() => void accountAction('save')}>Save progress</button>
      <button disabled={busy || !media} onClick={() => void accountAction('load')}>Retrieve progress</button>
      <Link to="/account/settings">Account settings</Link>
      <Link to="/auth/sign-out">Sign out</Link>
    </div> : <div className="flex gap-3 mt-3">
      <Link to="/auth/sign-in">Sign in with Google</Link>
    </div>}
    <p role="status">{message}</p>
  </details>
}
