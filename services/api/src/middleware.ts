// Gateway middleware: auth, rate limiting, zod validation, error mapping.
import type { Request, Response, NextFunction } from 'express'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import type { ZodSchema } from 'zod'
import { authenticate, AuthError, ForbiddenError } from '../../auth/src/index.ts'
import type { Principal } from '@semaje/schemas'
import { logError } from '../../observability/src/logger.ts'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { principal?: Principal; requestId?: string } }
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.principal = await authenticate(req.headers)
      next()
    } catch (e) { next(e) }
  }
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal
    if (!principal) return res.status(401).json({ error: 'Authentication required' })
    if (principal.via !== 'api-key' || principal.scopes.includes(scope)) return next()
    return res.status(403).json({ error: `API key requires the ${scope} scope` })
  }
}

const limiter = new RateLimiterMemory({
  points: Number(process.env.RATE_LIMIT_POINTS || 120),
  duration: Number(process.env.RATE_LIMIT_WINDOW_S || 60),
})

export function rateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.principal?.orgId || req.ip || 'anon'
    try {
      await limiter.consume(key)
      next()
    } catch {
      res.status(429).json({ error: 'Rate limit exceeded — slow down.' })
    }
  }
}

/** Parses req.body with a zod schema; 400 with details on failure. */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      })
    }
    req.body = parsed.data
    next()
  }
}

export function errorHandler() {
  return (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message })
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message })
    logError('request.failed', { error: err.message, status: err.status || 500 })
    res.status(err.status || 500).json({ error: err.message || 'Internal error' })
  }
}
