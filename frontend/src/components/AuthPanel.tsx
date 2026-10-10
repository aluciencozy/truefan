import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { authClient } from '../lib/auth'
import { api } from '../lib/api'
import type { Media, UserMediaState } from '../lib/types'

interface Props {
  media: Media | null
  progress: number
  onProgress: (unit: number) => void
  onIdentity: (id: string | null) => void
  onState: (state: UserMediaState) => void
}

export default function AuthPanel(props: Props) {
  if (!authClient) return <p className="account-note">Guest session. Configure Neon Auth to enable accounts.</p>
  return <ConfiguredAuth {...props} />
}

function ConfiguredAuth({ media, progress, onProgress, onIdentity, onState }: Props) {
  const client = authClient!
  const session = client.useSession()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const identity = session.data?.user.id ?? null
  const currentContext = useRef({ identity, mediaId: media?.id })
  currentContext.current = { identity, mediaId: media?.id }
  useEffect(() => { if (!session.isPending) onIdentity(identity) }, [identity, session.isPending, onIdentity])

  async function accountAction(action: 'check' | 'save' | 'load') {
    const context = currentContext.current
    const current = () => context.identity === currentContext.current.identity && context.mediaId === currentContext.current.mediaId
    setBusy(true); setMessage('')
    try {
      if (action === 'save' && media) {
        const saved = await api.saveProgress(media.id, progress)
        const [state] = await api.mediaState([media.id]); if (!current()) return; onState(state)
        setMessage(`Saved ${media.progress_unit} ${saved.progress.unit}.`)
      } else if (action === 'load' && media) {
        const saved = await api.progress(media.id)
        if (saved) {
          const [state] = await api.mediaState([media.id]); if (!current()) return; onState(state)
          onProgress(saved.progress.unit)
          setMessage(`Retrieved ${media.progress_unit} ${saved.progress.unit}.`)
        } else setMessage('No saved progress for this story yet.')
      } else {
        const user = await api.me()
        if (current()) setMessage(`Backend verified your identity: ${user.id}`)
      }
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : 'Account request failed.') }
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
