import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'node:module'
import { DEMO_TENANT, DEMO_NAME, DEMO_SLUG, departments, seedWorkflow } from './rail-demo-data.mjs'
dotenv.config()
const project = 'ehrgsakhrpbtintshjha',
  args = process.argv.slice(2)
const prepare = args.includes('--prepare'),
  workflowOnly = args.includes('--workflow-only')
if (
  process.env.NODE_ENV === 'production' ||
  !args.includes('--confirm-synthetic-demo') ||
  args[args.indexOf('--project-ref') + 1] !== project ||
  process.env.SUPABASE_URL !== `https://${project}.supabase.co`
)
  throw new Error('Explicit staging project identity and --confirm-synthetic-demo are required')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Configure the server-only Auth admin key in the ignored backend environment')
const connection = workflowOnly ? process.env.DATABASE_URL : process.env.MIGRATION_DATABASE_URL
if (!prepare) {
  if (!connection)
    throw new Error(
      'Configure the administrative MIGRATION_DATABASE_URL, or use --prepare and the connected database administrator before --workflow-only',
    )
  const target = new URL(connection)
  if (!(target.hostname.includes(project) || decodeURIComponent(target.username).includes(project)))
    throw new Error('Database URL must identify the same staging project')
}
const apiBase = process.env.DEMO_API_URL || 'http://127.0.0.1:4000/api'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api$/.test(apiBase))
  throw new Error('Demo API must be a local backend')
const fixturePath = new URL('../.env.rail-demo.json', import.meta.url)
let fixture
try {
  fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'))
} catch (e) {
  if (e.code !== 'ENOENT') throw e
  fixture = { tenantId: DEMO_TENANT, project, personas: {} }
}
if (fixture.tenantId !== DEMO_TENANT || fixture.project !== project)
  throw new Error('Refusing an unintended fixture or tenant')
const db = prepare
  ? null
  : new pg.Client({ connectionString: connection, connectionTimeoutMillis: 10000 })
const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { signToken } = createRequire(import.meta.url)('../dist/lib/jwt.js')
const persist = () => fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 })
const definitions = [
  ['admin', 'Demo administrator', 'admin', ['administrator'], departments[0].code],
  ['viewer', 'Demo viewer', 'viewer', ['viewer'], departments[0].code],
  ['cross-reviewer', 'Cross-department reviewer', 'approver', ['form_approver', 'viewer'], 'SIG'],
  ...departments.flatMap((d) =>
    [
      ['inspector', 'Inspector', 'inspector', ['inspector']],
      ['author', 'Form author', 'viewer', ['form_author', 'viewer']],
      ['reviewer', 'Form reviewer', 'approver', ['form_approver', 'viewer']],
    ].map(([key, label, role, caps]) => [
      `${d.code}-${key}`,
      `${d.name} ${label}`,
      role,
      caps,
      d.code,
    ]),
  ),
]
async function account(key) {
  let p = fixture.personas[key]
  if (!p) {
    p = {
      email: `synthetic-rail-${key.toLowerCase()}-${crypto.randomBytes(5).toString('hex')}@example.com`,
      password: crypto.randomBytes(32).toString('base64url') + 'aA1!',
    }
    fixture.personas[key] = p
    await persist()
  }
  if (!p.id) {
    const { data, error } = await auth.auth.admin.createUser({
      email: p.email,
      password: p.password,
      email_confirm: true,
    })
    if (error) throw error
    p.id = data.user.id
    await persist()
  }
  return p
}
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'"
try {
  if (prepare) {
    for (const [key] of definitions) await account(key)
    const sql = [
      'BEGIN;',
      `SELECT set_config('app.change_reason','Synthetic demo provisioning',true);`,
      `DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.tenants WHERE (id=${literal(DEMO_TENANT)} OR slug=${literal(DEMO_SLUG)}) AND (id<>${literal(DEMO_TENANT)} OR slug<>${literal(DEMO_SLUG)} OR name<>${literal(DEMO_NAME)})) THEN RAISE EXCEPTION 'Unintended tenant'; END IF; END $$;`,
      `INSERT INTO public.tenants(id,name,slug) VALUES(${literal(DEMO_TENANT)},${literal(DEMO_NAME)},${literal(DEMO_SLUG)}) ON CONFLICT(id) DO NOTHING;`,
    ]
    for (const d of departments)
      sql.push(
        `INSERT INTO public.departments(tenant_id,code,name) VALUES(${literal(DEMO_TENANT)},${literal(d.code)},${literal(d.name)}) ON CONFLICT(tenant_id,code) DO NOTHING;`,
      )
    for (const [key, name, role, caps, dept] of definitions) {
      const p = fixture.personas[key]
      sql.push(
        `DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.users WHERE id=${literal(p.id)} AND tenant_id<>${literal(DEMO_TENANT)}) THEN RAISE EXCEPTION 'Unintended user'; END IF; END $$;`,
      )
      sql.push(
        `INSERT INTO public.users(id,tenant_id,name,email,staff_id,role,primary_department_id,capabilities) SELECT a.id,${literal(DEMO_TENANT)},${literal('SYNTHETIC — ' + name)},a.email,${literal('DEMO-' + key)},${literal(role)}::public.user_role,d.id,ARRAY[${caps.map(literal).join(',')}]::text[] FROM auth.users a JOIN public.departments d ON d.tenant_id=${literal(DEMO_TENANT)} AND d.code=${literal(dept)} WHERE a.id=${literal(p.id)} ON CONFLICT(id) DO UPDATE SET active=true,name=excluded.name,primary_department_id=excluded.primary_department_id,capabilities=excluded.capabilities;`,
      )
    }
    sql.push(
      `INSERT INTO public.department_memberships(tenant_id,user_id,department_id) SELECT ${literal(DEMO_TENANT)},${literal(fixture.personas['cross-reviewer'].id)},id FROM public.departments WHERE tenant_id=${literal(DEMO_TENANT)} AND code='RS' ON CONFLICT DO NOTHING;`,
      'COMMIT;',
    )
    await fs.writeFile(
      new URL('../.env.rail-demo.provision.sql', import.meta.url),
      sql.join('\n'),
      { mode: 0o600 },
    )
    console.log(
      'Prepared 27 synthetic Auth personas and ignored backend/.env.rail-demo.provision.sql. Review and apply that tenant-scoped provisioning SQL as the database administrator, then run --workflow-only. Credentials remain in ignored backend/.env.rail-demo.json.',
    )
  } else {
    await db.connect()
    if (workflowOnly) {
      if (!fixture.personas.admin?.id) throw new Error('Prepare and provision demo personas first')
      await db.query("SELECT set_config('app.actor_id',$1,false)", [fixture.personas.admin.id])
    }
    const row = (
      await db.query('SELECT id,name,slug FROM public.tenants WHERE id=$1 OR slug=$2', [
        DEMO_TENANT,
        DEMO_SLUG,
      ])
    ).rows
    if (row.some((t) => t.id !== DEMO_TENANT || t.slug !== DEMO_SLUG || t.name !== DEMO_NAME))
      throw new Error('Existing tenant identity does not match the dedicated synthetic demo tenant')
    if (args.includes('--cleanup')) {
      if (!row.length) throw new Error('Demo tenant does not exist')
      await db.query('UPDATE public.users SET active=false WHERE tenant_id=$1', [DEMO_TENANT])
      console.log(
        'Demo personas deactivated. Signed demonstration records and audit history retained.',
      )
    } else {
      if (workflowOnly && !row.length) throw new Error('Provision the dedicated demo tenant first')
      if (!workflowOnly)
        await db.query(
          'INSERT INTO public.tenants(id,name,slug) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
          [DEMO_TENANT, DEMO_NAME, DEMO_SLUG],
        )
      const departmentIds = {}
      for (const d of departments) {
        const result = workflowOnly
          ? await db.query('SELECT id FROM public.departments WHERE tenant_id=$1 AND code=$2', [
              DEMO_TENANT,
              d.code,
            ])
          : await db.query(
              'INSERT INTO public.departments(tenant_id,code,name) VALUES($1,$2,$3) ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name RETURNING id',
              [DEMO_TENANT, d.code, d.name],
            )
        if (!result.rows.length) throw new Error('Demo department provisioning is incomplete')
        departmentIds[d.code] = result.rows[0].id
      }
      if (!workflowOnly) {
        for (const [key, name, role, caps, dept] of definitions) {
          const p = await account(key),
            existing = (await db.query('SELECT tenant_id FROM public.users WHERE id=$1', [p.id]))
              .rows[0]
          if (existing && existing.tenant_id !== DEMO_TENANT)
            throw new Error('Refusing to modify an account from another tenant')
          await db.query(
            'INSERT INTO public.users(id,tenant_id,name,email,staff_id,role,primary_department_id,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET active=true,name=excluded.name,primary_department_id=excluded.primary_department_id,capabilities=excluded.capabilities',
            [
              p.id,
              DEMO_TENANT,
              `SYNTHETIC — ${name}`,
              p.email,
              `DEMO-${key}`,
              role,
              departmentIds[dept],
              caps,
            ],
          )
        }
        await db.query(
          'INSERT INTO public.department_memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [DEMO_TENANT, fixture.personas['cross-reviewer'].id, departmentIds.RS],
        )
      }
      const tokens = {}
      const request = async (persona, method, path, body) => {
        if (!tokens[persona]) {
          const p = fixture.personas[persona],
            verified = await auth.auth.signInWithPassword({ email: p.email, password: p.password })
          if (verified.error || verified.data.user?.id !== p.id)
            throw new Error('Synthetic Auth account verification failed')
          const profile = (
            await db.query(
              'SELECT u.*,v.auth_version FROM public.users u JOIN inspectai_private.session_versions v ON v.id=u.id WHERE u.id=$1 AND u.tenant_id=$2 AND u.active',
              [p.id, DEMO_TENANT],
            )
          ).rows[0]
          if (!profile) throw new Error('Synthetic profile verification failed')
          // Controlled fixture sessions use the existing issuer after Auth verification.
          // They do not disable the interactive-login limiter or any business guard.
          tokens[persona] = signToken({
            id: profile.id,
            tenantId: profile.tenant_id,
            name: profile.name,
            email: profile.email,
            staffId: profile.staff_id,
            role: profile.role,
            authVersion: profile.auth_version,
          })
        }
        const r = await fetch(apiBase + path, {
            method,
            headers: {
              Authorization: `Bearer ${tokens[persona]}`,
              'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
          data = await r.json()
        if (!r.ok) throw new Error(`${method} ${path}: ${data.error || r.status}`)
        return data
      }
      const counts = await seedWorkflow({ request, departmentIds, personas: fixture.personas })
      if (counts.assets !== 60 || counts.distinctForms !== 20 || counts.workOrders < 20)
        throw new Error('Unexpected demo counts')
      console.log(
        'Synthetic demo ready:',
        counts,
        'Credentials are saved only in ignored backend/.env.rail-demo.json',
      )
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await db?.end().catch(() => {})
}
