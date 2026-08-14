import type { Request, Response, NextFunction } from 'express'

export function errorHandler(
  err: Error & { code?: string; status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('[error]', err.message)
  if (process.env.NODE_ENV !== 'production') {
    console.error(err)
  }
  if (err.code === '23503') {
    res.status(400).json({ error: 'The request references data that does not exist or is not available' }); return
  }
  if (err.code === '22P02') {
    res.status(400).json({ error: 'One or more values have an invalid format' }); return
  }
  if (err.code === '23505') {
    res.status(409).json({ error: 'A record with the same unique value already exists. Check the WI number and revision before retrying.' }); return
  }
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500
  res.status(status).json({
    error: err.status || process.env.NODE_ENV !== 'production' ? err.message : 'Internal server error',
    code: err.code,
  })
}
