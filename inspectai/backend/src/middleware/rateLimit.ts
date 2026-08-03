import type { Request, Response, NextFunction } from 'express'

interface Entry { count: number; resetAt: number }

/** Process-local guard. Use a shared Redis limiter when running multiple API instances. */
export function createRateLimiter(max: number, windowMs: number) {
  const entries = new Map<string, Entry>()

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const current = entries.get(key)
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current

    entry.count += 1
    entries.set(key, entry)

    if (entries.size > 10_000) {
      for (const [entryKey, value] of entries) {
        if (value.resetAt <= now) entries.delete(entryKey)
      }
    }

    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000))
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
      return
    }
    next()
  }
}
