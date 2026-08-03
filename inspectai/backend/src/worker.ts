import dotenv from 'dotenv'
import { claimJobs, completeJob, failJob, type JobType } from './lib/jobs'
import { createNotification } from './lib/events'
import { pool } from './lib/db'

dotenv.config()

type Job = {
  id: string
  job_type: JobType
  tenant_id: string
  user_id: string | null
  payload: Record<string, unknown>
}

let stopping = false

function stringValue(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === 'string' ? payload[key] as string : ''
}

async function processJob(job: Job) {
  if (job.job_type === 'notification') {
    if (!job.user_id) throw new Error('Notification job requires user_id')
    const title = stringValue(job.payload, 'title')
    const message = stringValue(job.payload, 'message')
    if (!title || !message) throw new Error('Notification job requires title and message')
    await createNotification({
      tenantId: job.tenant_id,
      userId: job.user_id,
      title,
      message,
      severity: stringValue(job.payload, 'severity') as 'info' | 'warning' | 'critical' | 'success' || 'info',
      entityType: stringValue(job.payload, 'entityType') || null,
      entityId: stringValue(job.payload, 'entityId') || null,
    })
    return
  }

  throw new Error(`No worker handler configured for job type: ${job.job_type}`)
}

async function runOnce() {
  const jobs = await claimJobs(Number(process.env.WORKER_BATCH_SIZE ?? 10)) as Job[]
  for (const job of jobs) {
    try {
      await processJob(job)
      await completeJob(job.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown worker error'
      console.error(`[worker] job ${job.id} failed: ${message}`)
      await failJob(job.id, message)
    }
  }
  return jobs.length
}

async function start() {
  console.log('[worker] started')
  while (!stopping) {
    try {
      const processed = await runOnce()
      if (processed === 0) await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (err) {
      console.error('[worker] polling failed:', err instanceof Error ? err.message : err)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
  await pool.end()
  console.log('[worker] stopped')
}

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received; stopping after current batch`)
  stopping = true
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
start().catch(err => {
  console.error('[worker] fatal error:', err)
  process.exitCode = 1
})
