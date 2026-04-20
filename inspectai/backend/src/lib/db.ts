import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:              10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message)
})

/** Drop-in query helper — use instead of pool.query directly. */
export const query = (text: string, params?: unknown[]) =>
  pool.query(text, params)
