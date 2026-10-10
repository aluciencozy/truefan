import { createAuthClient } from '@neondatabase/auth'
import { BetterAuthReactAdapter } from '@neondatabase/auth/react/adapters'

const url = import.meta.env.VITE_NEON_AUTH_URL?.trim()
export const authClient = url
  ? createAuthClient(url, { adapter: BetterAuthReactAdapter() })
  : null
