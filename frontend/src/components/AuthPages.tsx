import { AccountView, AuthView } from '@neondatabase/auth-ui'
import { Link, Navigate, useParams } from 'react-router-dom'
import { authClient } from '../lib/auth'

export default function AuthPages({ account = false }: { account?: boolean }) {
  const { path } = useParams()
  if (account && path !== 'settings') return <Navigate to="/account/settings" replace />
  return <main className="auth-shell celestial">
    <header className="auth-header">
      <Link className="auth-back" to="/" aria-label="Back to TrueFan" title="Back to TrueFan">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 12H4m7-7-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <Link className="home-brand" to="/"><img src="/home/brand.svg" width="26" height="26" alt="" />TrueFan</Link>
    </header>
    <div className="auth-page">
      {authClient ? account
        ? <>
          <div className="auth-introduction"><h1>My account</h1><p>A little space for your details.</p></div>
          <AccountView view="SETTINGS" hideNav localization={{
            NAME_DESCRIPTION: '', NAME_INSTRUCTIONS: '', EMAIL_DESCRIPTION: '', EMAIL_INSTRUCTIONS: '',
          }} classNames={{ card: {
            base: 'auth-card', header: 'auth-card-header', content: 'auth-card-content',
            footer: 'auth-card-footer', title: 'auth-card-title', button: 'auth-primary',
          } }} />
          <Link className="auth-signout" to="/auth/sign-out">Sign out</Link>
        </>
        : <AuthView path={path || 'sign-in'} classNames={{
          base: 'auth-card', header: 'auth-card-header', content: 'auth-card-content',
          footer: 'auth-card-footer', title: 'auth-title',
        }} />
        : <><h1>Accounts are coming soon.</h1><p>You can explore stories without an account.</p><Link to="/">Find a story</Link></>}
    </div>
  </main>
}
