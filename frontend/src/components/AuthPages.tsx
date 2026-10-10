import { AccountView, AuthView } from '@neondatabase/auth-ui'
import { Link, useParams } from 'react-router-dom'
import { authClient } from '../lib/auth'

export default function AuthPages({ account = false }: { account?: boolean }) {
  const { path } = useParams()
  return <main className="app-shell">
    <Link to="/">Back to your story</Link>
    <div className="auth-page">
      {authClient ? account
        ? <AccountView path={path || 'settings'} />
        : <AuthView path={path || 'sign-in'} />
        : <p>Set VITE_NEON_AUTH_URL to enable accounts.</p>}
    </div>
  </main>
}
