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
import { errorHandler }    from './middleware/errorHandler'

dotenv.config()

const app  = express()
const PORT = process.env.PORT ?? 4000

// ── Middleware ──────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Routes ──────────────────────────────────────────────────
app.use('/api/auth',              authRouter)
app.use('/api/inspections',       inspectionsRouter)
app.use('/api/work-instructions', wiRouter)
app.use('/api/approvals',         approvalsRouter)
app.use('/api/notifications',     notificationsRouter)
app.use('/api/analytics',         analyticsRouter)
app.use('/api/ai',                aiRouter)
app.use('/api/moms',             momsRouter)

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// ── Error handler (must be last) ────────────────────────────
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`[inspectai-backend] listening on http://localhost:${PORT}`)
})

export default app
