import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { migrationPlan } from './migration-plan.mjs'

// Restores an ignored public-schema snapshot locally. No hosted writes.
const snapshot = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const { schema, data } = snapshot
const db = new PGlite()
const quote = (value) => '"' + value.replaceAll('"', '""') + '"'
const literal = (value) => "'" + value.replaceAll("'", "''") + "'"
try {
  const roles = new Set([
    'anon',
    'authenticated',
    'service_role',
    ...schema.grants.map((g) => g.grantee),
  ])
  for (const role of roles)
    if (!['PUBLIC', 'postgres'].includes(role)) await db.exec(`CREATE ROLE ${quote(role)}`)
  await db.exec(
    'CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, encrypted_password text); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;',
  )
  for (const row of data.users)
    await db.query('INSERT INTO auth.users(id,encrypted_password) VALUES($1,$2)', [
      row.id,
      'local-restore-only',
    ])
  for (const type of schema.enums)
    await db.exec(
      `CREATE TYPE public.${quote(type.name)} AS ENUM (${type.values.map(literal).join(',')})`,
    )
  for (const table of schema.tables) {
    await db.exec(
      `CREATE TABLE public.${quote(table.name)} (${table.columns.map((c) => `${quote(c.name)} ${c.type}${c.default ? ' DEFAULT ' + c.default : ''}${c.notnull ? ' NOT NULL' : ''}`).join(',')})`,
    )
  }
  for (const [table, rows] of Object.entries(data)) {
    for (const row of rows)
      await db.query(
        `INSERT INTO public.${quote(table)} SELECT * FROM jsonb_populate_record(NULL::public.${quote(table)}, $1::jsonb)`,
        [JSON.stringify(row)],
      )
  }
  for (const constraint of [...schema.constraints].sort(
    (a, b) => Number(a.type === 'f') - Number(b.type === 'f'),
  ))
    await db.exec(
      `ALTER TABLE public.${quote(constraint.table)} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition}`,
    )
  for (const index of schema.indexes)
    if (
      !schema.constraints.some(
        (c) => index.includes(quote(c.name) + ' ON') || index.includes('INDEX ' + c.name + ' ON'),
      )
    )
      await db.exec(index)
  for (const fn of schema.functions) await db.exec(fn)
  for (const view of schema.views)
    await db.exec(`CREATE VIEW public.${quote(view.name)} AS ${view.definition}`)
  for (const trigger of schema.triggers) await db.exec(trigger)
  for (const table of schema.tables)
    if (table.rls)
      await db.exec(`ALTER TABLE public.${quote(table.name)} ENABLE ROW LEVEL SECURITY`)
  for (const p of schema.policies)
    await db.exec(
      `CREATE POLICY ${quote(p.policyname)} ON public.${quote(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map((r) => (r === 'public' ? 'PUBLIC' : quote(r))).join(',')}${p.qual ? ' USING (' + p.qual + ')' : ''}${p.with_check ? ' WITH CHECK (' + p.with_check + ')' : ''}`,
    )
  for (const g of schema.grants)
    await db.exec(
      `GRANT ${g.privilege_type} ON public.${quote(g.table_name)} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : quote(g.grantee)}`,
    )
  for (const [table, rows] of Object.entries(data))
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM public.${quote(table)}`)).rows[0].n,
      rows.length,
    )
  console.log('PASS restored pre-migration public schema and all table row counts locally')
  await db.exec(
    'CREATE TABLE public.inspectai_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now()); ALTER TABLE public.inspectai_migrations ENABLE ROW LEVEL SECURITY;',
  )
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  for (const name of migrationPlan(await fs.readdir(directory))) {
    await db.exec(await fs.readFile(new URL(name, directory), 'utf8'))
    await db.query('INSERT INTO public.inspectai_migrations(name) VALUES($1)', [name])
  }
  for (const [table, rows] of Object.entries(data)) {
    const actual = (await db.query(`SELECT * FROM public.${quote(table)}`)).rows
    if (table === 'audit_logs')
      assert(
        actual.length >= rows.length,
        'Migration preserves all legacy events and may add transactional backfill events',
      )
    else assert.equal(actual.length, rows.length)
    for (const original of rows) {
      const restored = actual.find((row) => String(row.id) === String(original.id))
      for (const [key, value] of Object.entries(original)) {
        const got = restored[key]
        assert.deepEqual(
          got instanceof Date ? got.toISOString() : got,
          got instanceof Date && value !== null ? new Date(value).toISOString() : value,
          `${table}.${key}`,
        )
      }
    }
  }
  const guards = await db.query(
    "SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('guard_instruction_items','guard_instruction_revision','guard_finding','guard_signed_record','guard_work_order')",
  )
  assert.equal(guards.rows[0].n, 5)
  await db.exec('SET ROLE inspectai_runtime')
  await db.query('SELECT id,tenant_id,role FROM public.users')
  await db.query(
    'SELECT u.id,av.auth_version FROM public.users u JOIN inspectai_private.session_versions av ON av.id=u.id',
  )
  await assert.rejects(db.query('SELECT encrypted_password FROM auth.users'), /permission denied/)
  await assert.rejects(
    db.query('UPDATE public.audit_logs SET action=$1', ['tamper']),
    /permission denied/,
  )
  await db.exec('RESET ROLE; SET ROLE authenticated')
  await assert.rejects(db.query('SELECT * FROM public.users'), /permission denied/)
  await assert.rejects(
    db.query('SELECT * FROM inspectai_private.session_versions'),
    /permission denied/,
  )
  await assert.rejects(db.query('SELECT public.refresh_wi_status()'), /permission denied/)
  console.log(
    'PASS legacy upgrade, existing values preserved, runtime access, browser denial and five integrity guards',
  )
} finally {
  await db.close()
}
