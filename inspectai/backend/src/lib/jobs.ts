import { pool, query } from './db'

export type JobType = 'ai_analysis' | 'report_generation' | 'moms_import' | 'notification'

export interface JobInput {
  type: JobType
  tenantId: string
  userId?: string | null
  payload: Record<string, unknown>
  availableAt?: Date
}

export async function enqueueJob(input: JobInput) {
  const result = await query(
    `INSERT INTO public.job_queue (tenant_id, user_id, job_type, payload, available_at)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, job_type, available_at`,
    [input.tenantId, input.userId ?? null, input.type, input.payload, input.availableAt ?? new Date()]
  )
  return result.rows[0] as { id: string; job_type: JobType; available_at: Date }
}

export async function claimJobs(limit = 10) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `WITH candidates AS (
         SELECT id FROM public.job_queue
         WHERE status = 'queued'
           AND available_at <= NOW()
           AND attempts < max_attempts
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public.job_queue j
       SET status = 'processing', attempts = j.attempts + 1,
           locked_at = NOW(), updated_at = NOW()
       FROM candidates c
       WHERE j.id = c.id
       RETURNING j.*`,
      [Math.min(50, Math.max(1, limit))]
    )
    await client.query('COMMIT')
    return result.rows
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export async function completeJob(id: string) {
  await query(
    `UPDATE public.job_queue
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id]
  )
}

export async function failJob(id: string, error: string, retryAt?: Date) {
  await query(
    `UPDATE public.job_queue
     SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
         last_error = $2, available_at = COALESCE($3, available_at), updated_at = NOW()
     WHERE id = $1`,
    [id, error.slice(0, 2000), retryAt ?? new Date(Date.now() + 60_000)]
  )
}
