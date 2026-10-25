import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

dotenv.config()
if (process.env.NODE_ENV === 'production' || process.env.SUPABASE_URL !== 'https://ehrgsakhrpbtintshjha.supabase.co') throw new Error('This script is limited to the authorized inspectai staging project')
const file = new URL('../.env.staging-test-users.json', import.meta.url)
let fixture
try { fixture = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) {
 if (error.code !== 'ENOENT') throw error
 const run = crypto.randomBytes(6).toString('hex')
 fixture = { run, tenantId: crypto.randomUUID(), otherTenantId: crypto.randomUUID(), users: {} }
 for (const role of ['admin', 'approver', 'inspector', 'viewer', 'foreign']) fixture.users[role] = { email: `inspectai-${role}-${run}@example.com`, password: crypto.randomBytes(30).toString('base64url')+'aA1!', role: role === 'foreign' ? 'inspector' : role }
 await fs.writeFile(file, JSON.stringify(fixture, null, 2), {mode:0o600})
}
const client = new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000})
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}})
try {
 await client.connect()
 for (const [id, label] of [[fixture.tenantId, 'workflow'], [fixture.otherTenantId, 'isolation']]) await client.query('INSERT INTO public.tenants(id,name,slug) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [id, `Staging verification ${label} ${fixture.run}`, `verify-${label}-${fixture.run}`])
 for (const [label, user] of Object.entries(fixture.users)) {
  if (!user.id) {
   const {data,error} = await admin.auth.admin.createUser({email:user.email,password:user.password,email_confirm:true,user_metadata:{name:`Staging ${label}`,role:'admin'}})
   if (error) throw error
   user.id=data.user.id
   await fs.writeFile(file,JSON.stringify(fixture,null,2),{mode:0o600})
  }
  // The signup trigger must not have created an app profile from user metadata.
  const existing=await client.query('SELECT id FROM public.users WHERE id=$1',[user.id])
  if (!existing.rowCount) await client.query('INSERT INTO public.users(id,tenant_id,name,email,staff_id,role) VALUES($1,$2,$3,$4,$5,$6)',[user.id,label==='foreign'?fixture.otherTenantId:fixture.tenantId,`Staging ${label}`,user.email,`VERIFY-${label}`,user.role])
 }
 console.log('PASS five dedicated Auth test users and two isolated staging tenants provisioned; credentials saved only in ignored backend/.env.staging-test-users.json')
} catch(error) { console.error(error.message);process.exitCode=1 } finally { await client.end().catch(()=>{}) }
