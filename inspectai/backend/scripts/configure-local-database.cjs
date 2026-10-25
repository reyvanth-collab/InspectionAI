const fs = require('node:fs')
const path = require('node:path')
const pg = require('pg')
const dotenv = require('dotenv')

// Reads ignored secrets; prints only status, never passwords or connection URLs.
async function main() {
 const directory = path.resolve(__dirname, '..')
 const secret = JSON.parse(fs.readFileSync(path.resolve(directory, '../../.env.runtime-provisioning.json'), 'utf8'))
 const certificate = path.resolve(directory, '.env.supabase-ca.crt')
 if (!fs.existsSync(certificate)) {
  // Same production certificate URL used by Supabase Studio's download link.
  const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt')
  if (!response.ok) throw new Error('Cannot download the official Supabase root certificate')
  const pem = await response.text()
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('Invalid certificate response')
  fs.writeFileSync(certificate, pem)
 }
 const hosts = ['aws-0-ap-northeast-1.pooler.supabase.com', 'aws-1-ap-northeast-1.pooler.supabase.com']
 for (const host of hosts) {
  const url = new URL(`postgresql://inspectai_runtime.ehrgsakhrpbtintshjha@${host}:5432/postgres`)
  url.password = secret.password
  url.searchParams.set('sslmode', 'verify-full')
  url.searchParams.set('sslrootcert', certificate)
  const client = new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:8000})
  try {
   await client.connect()
   const result = await client.query('SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user')
   if (result.rows[0].current_user !== 'inspectai_runtime' || result.rows[0].rolbypassrls || result.rows[0].rolsuper) throw new Error('Unexpected database privileges')
   await client.query('SELECT id FROM public.users LIMIT 1')
   const file = path.join(directory, '.env')
   const env = dotenv.parse(fs.readFileSync(file))
   env.DATABASE_URL = url.toString()
   fs.writeFileSync(file, Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n')+'\n', {mode:0o600})
   console.log('PASS restricted runtime connection with verified TLS; backend environment updated')
   return
  } catch (error) {
   console.log(`${host}: ${error.code ?? error.name}; ${error.message.replaceAll(secret.password,'[redacted]')}`)
  } finally { await client.end().catch(()=>{}) }
 }
 process.exitCode=1
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
