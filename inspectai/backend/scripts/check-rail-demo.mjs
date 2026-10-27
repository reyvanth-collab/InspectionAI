import fs from 'node:fs/promises'
import dotenv from 'dotenv'
import { DEMO_TENANT } from './rail-demo-data.mjs'
import { verifyRailDemo } from './verify-rail-demo-data.mjs'
dotenv.config()
const project = 'ehrgsakhrpbtintshjha'
try {
  if (process.env.NODE_ENV === 'production' || process.env.SUPABASE_URL !== `https://${project}.supabase.co`) throw new Error('Demo verification requires the existing staging project and a non-production local backend.')
  const base = process.env.DEMO_API_URL || 'http://127.0.0.1:4000/api'
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api$/.test(base)) throw new Error('Use a local backend URL.')
  const fixture = JSON.parse(await fs.readFile(new URL('../.env.rail-demo.json', import.meta.url), 'utf8'))
  if (fixture.project !== project || fixture.tenantId !== DEMO_TENANT || !fixture.personas?.admin?.email || !fixture.personas?.admin?.password) throw new Error('The local file must contain the dedicated rail-demo administrator.')
  const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.personas.admin.email, password: fixture.personas.admin.password }), signal: AbortSignal.timeout(30000) })
  const login = await response.json()
  if (!response.ok || !login.token) throw new Error('Demo login failed. Check the local backend/project and provisioned demo account; credentials were not printed.')
  const get = async path => {
    const result = await fetch(base + path, { headers: { Authorization: `Bearer ${login.token}` }, signal: AbortSignal.timeout(30000) })
    if (!result.ok) throw new Error(`Demo data check failed with HTTP ${result.status}. Verify this branch and database migrations.`)
    return result.json()
  }
  console.log(JSON.stringify(await verifyRailDemo(get), null, 2))
  console.log('Open frontend at http://localhost:3000. Sign out of the current workspace, then use personas.admin from the ignored backend/.env.rail-demo.json. Open that file locally; do not paste passwords into chat. Departmental personas intentionally see fewer records.')
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'Missing ignored backend/.env.rail-demo.json. Copy the existing file from the original checkout, or follow docs/RAIL_DEMO.md to provision demo access. Pulling code does not copy database records or create login credentials.'
    : error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
