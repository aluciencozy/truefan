import type { ReactNode } from 'react'
import { NeonAuthUIProvider } from '@neondatabase/auth-ui'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '../lib/auth'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  if (!authClient) return children
  return <NeonAuthUIProvider authClient={authClient} defaultTheme="dark"
    social={{ providers: ['google'] }} credentials={false}
    navigate={path => navigate(path)} replace={path => navigate(path, { replace: true })}
    redirectTo="/" Link={({ href, ...props }) => <Link to={href} {...props} />}>
    {children}
  </NeonAuthUIProvider>
}
