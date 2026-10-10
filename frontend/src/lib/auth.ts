import { createAuthClient } from '@neondatabase/neon-js/auth'
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters'

const url = import.meta.env.VITE_NEON_AUTH_URL?.trim()
export const authClient = url
  ? createAuthClient(url, {
      adapter: BetterAuthReactAdapter({ fetchOptions: { credentials: 'include' } }),
    })
  : null
