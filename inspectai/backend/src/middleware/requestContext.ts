import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header('x-request-id') || crypto.randomUUID()
  const startedAt = Date.now()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => {
    const duration = Date.now() - startedAt
    if (duration >= 1000) {
      console.warn(`[slow-request] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms request_id=${requestId}`)
    }
  })
  next()
}
