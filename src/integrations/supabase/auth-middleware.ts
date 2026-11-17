import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

// Server functions that need a signed-in user: checks the bearer token (attached by auth-attacher.ts) and gives the
// handler a database client limited to that user's rows.
export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const auth = getRequest()?.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) throw new Error('Unauthorized: No authorization header provided')
    const { verifyToken } = await import('@/lib/notion-db.server')
    const user = await verifyToken(auth.slice(7).trim())
    if (!user) throw new Error('Unauthorized: Invalid token')
    const { userClient } = await import('./client.server')
    return next({
      context: {
        supabase: userClient(user.id),
        userId: user.id,
        claims: { sub: user.id, email: user.email },
      },
    })
  },
)
