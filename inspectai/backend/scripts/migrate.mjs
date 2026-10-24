import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase')
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('Set the administrative MIGRATION_DATABASE_URL; never give this URL to the application')
const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
try {
 await client.connect()
 await client.query('SELECT pg_advisory_lock(91827463)')
 const exists = await client.query("SELECT to_regclass('public.tenants') AS table_name")
 const fresh = !exists.rows[0].table_name
 if (fresh) await client.query(await fs.readFile(path.join(root,'schema.sql'),'utf8'))
 await client.query('CREATE TABLE IF NOT EXISTS public.inspectai_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())')
 for (const name of (await fs.readdir(path.join(root,'migrations'))).filter(n=>n.endsWith('.sql')).sort()) {
  if (fresh && name < '20261025000000') { await client.query('INSERT INTO public.inspectai_migrations(name) VALUES($1) ON CONFLICT DO NOTHING',[name]); continue }
  const applied=await client.query('SELECT 1 FROM public.inspectai_migrations WHERE name=$1',[name]); if(applied.rowCount) continue
  await client.query(await fs.readFile(path.join(root,'migrations',name),'utf8'))
  await client.query('INSERT INTO public.inspectai_migrations(name) VALUES($1)',[name])
  console.log('Applied', name)
 }
} finally { await client.end() }
