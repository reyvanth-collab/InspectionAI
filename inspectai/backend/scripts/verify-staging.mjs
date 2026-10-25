import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
const checks = []
try {
  await client.connect()
  const requiredTables = ['assets', 'work_orders', 'job_queue', 'audit_logs', 'moms_checklist_steps', 'import_receipts']
  const tables = await client.query(
    `SELECT c.relname, c.relrowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
    [requiredTables]
  )
  for (const table of requiredTables) {
    const row = tables.rows.find(value => value.relname === table)
    checks.push({ check: `table:${table}`, pass: Boolean(row?.relrowsecurity), rls: row?.relrowsecurity ?? false })
  }

  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'work_orders' AND column_name = 'asset_record_id'`
  )
  checks.push({ check: 'column:work_orders.asset_record_id', pass: columns.rowCount === 1 })

  const policies = await client.query(
    `SELECT tablename, COUNT(*)::int AS count
     FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('assets', 'work_orders', 'job_queue')
     GROUP BY tablename`
  )
  for (const table of ['assets', 'work_orders', 'job_queue']) {
    checks.push({ check: `policies:${table}`, pass: policies.rows.some(row => row.tablename === table && row.count > 0) })
  }

  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname IN ('idx_assets_tenant_status', 'idx_wo_asset_record', 'idx_job_queue_claim')`
  )
  for (const index of ['idx_assets_tenant_status', 'idx_wo_asset_record', 'idx_job_queue_claim']) {
    checks.push({ check: `index:${index}`, pass: indexes.rows.some(row => row.indexname === index) })
  }

  const migration = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_records' AND column_name='signed_payload'")
  checks.push({ check: 'signed_payload_migration', pass: migration.rowCount === 1 })
  const demos = await client.query("SELECT count(*)::int AS count FROM public.users WHERE id::text LIKE 'aaaaaaaa-0001-%'")
  checks.push({ check: 'no_demo_accounts', pass: demos.rows[0].count === 0 })
  const failures = checks.filter(check => !check.pass)
  console.log(JSON.stringify({ database: 'connected', checks, passed: checks.length - failures.length, failed: failures.length }, null, 2))
  if (failures.length) process.exitCode = 1
} catch (error) {
  console.error('Staging verification failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
