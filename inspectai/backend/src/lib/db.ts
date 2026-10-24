import { Pool } from 'pg'
import dotenv from 'dotenv'
import { actorContext } from './actor'

dotenv.config()

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in production')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:              Math.max(5, Math.min(50, Number(process.env.DB_POOL_MAX ?? 20))),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message)
})

/** Drop-in query helper — use instead of pool.query directly. */
export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.actor_id', $1, true)", [actorContext.getStore() ?? ''])
    const result = await client.query(text, params)
    await client.query('COMMIT')
    return result
  } catch (err) { await client.query('ROLLBACK').catch(() => undefined); throw err } finally { client.release() }
}
export async function beginActorTransaction(client: import('pg').PoolClient) {
 await client.query('BEGIN')
 await client.query("SELECT set_config('app.actor_id', $1, true)", [actorContext.getStore() ?? ''])
}
