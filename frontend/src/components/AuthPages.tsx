import { AccountView, AuthView } from '@neondatabase/auth-ui'
import { Link, useParams } from 'react-router-dom'
import { authClient } from '../lib/auth'

export default function AuthPages({ account = false }: { account?: boolean }) {
  const { path } = useParams()
  return <main className="app-shell">
    <Link to="/">Back to TrueFan</Link>
    <div className="auth-page">
      {authClient ? account
        ? <AccountView path={path || 'settings'} />
        : <AuthView path={path || 'sign-in'} />
        : <><h1>Accounts are coming soon.</h1><p>You can explore stories without an account.</p><Link to="/explore">Explore as a guest</Link></>}
    </div>
  </main>
}
