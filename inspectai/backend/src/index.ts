import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'

import authRouter          from './routes/auth'
import inspectionsRouter   from './routes/inspections'
import wiRouter            from './routes/workInstructions'
import approvalsRouter     from './routes/approvals'
import notificationsRouter from './routes/notifications'
import analyticsRouter     from './routes/analytics'
import aiRouter            from './routes/ai'
import momsRouter          from './routes/moms'
import reportsRouter       from './routes/reports'
import usersRouter         from './routes/users'
import assetsRouter        from './routes/assets'
import { errorHandler }    from './middleware/errorHandler'
import { validateProductionConfig } from './lib/config'
import { query } from './lib/db'
import { requestContext } from './middleware/requestContext'

dotenv.config()
validateProductionConfig()

const app  = express()
const PORT = process.env.PORT ?? 4000
const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

// ── Middleware ──────────────────────────────────────────────
app.use(helmet())
app.use(requestContext)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Origin is not allowed'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '30mb' }))
app.use(express.urlencoded({ extended: true, limit: '30mb' }))

// ── Routes ──────────────────────────────────────────────────
app.use('/api/auth',              authRouter)
app.use('/api/inspections',       inspectionsRouter)
app.use('/api/work-instructions', wiRouter)
app.use('/api/approvals',         approvalsRouter)
app.use('/api/notifications',     notificationsRouter)
app.use('/api/analytics',         analyticsRouter)
app.use('/api/ai',                aiRouter)
app.use('/api/moms',             momsRouter)
app.use('/api/reports',          reportsRouter)
app.use('/api/users',            usersRouter)
app.use('/api/assets',           assetsRouter)

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: process.env.APP_VERSION ?? 'development',
    uptimeSeconds: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  })
})

app.get('/api/ready', async (_req, res) => {
  try {
    await query('SELECT 1')
    res.json({ status: 'ready', database: 'ok' })
  } catch {
    res.status(503).json({ status: 'not_ready', database: 'unavailable' })
  }
})

// ── Error handler (must be last) ────────────────────────────
app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`[inspectai-backend] listening on http://localhost:${PORT}`)
})

const shutdown = (signal: string) => {
  console.log(`[inspectai-backend] ${signal} received; draining connections`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 15_000).unref()
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

export default app
