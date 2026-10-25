import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import {createClient} from '@supabase/supabase-js'
dotenv.config()
if (process.env.NODE_ENV === 'production' || process.env.SUPABASE_URL !== 'https://ehrgsakhrpbtintshjha.supabase.co') throw new Error('Authorized inspectai staging only')
const file=new URL('../.env.staging-test-users.json',import.meta.url)
const fixture=JSON.parse(await fs.readFile(file,'utf8'))
const user=fixture.users.viewer
const base='http://127.0.0.1:4000/api'
const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const browser=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const db=new pg.Client({connectionString:process.env.DATABASE_URL})
async function login() {
 const response=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})})
 assert.equal(response.status,200)
 return (await response.json()).token
}
async function me(token,status) {const response=await fetch(base+'/auth/me',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,status);return response.json()}
try {
 await db.connect()
 const oldToken=await login()
 const result=await browser.auth.signInWithPassword({email:user.email,password:user.password})
 if(result.error)throw result.error
 const metadata=await browser.auth.updateUser({data:{role:'admin',tenant_id:fixture.otherTenantId}})
 if(metadata.error)throw metadata.error
 const profile=await me(oldToken,200)
 assert.equal(profile.data.role,'viewer');assert.equal(profile.data.tenantId,fixture.tenantId)
 await db.query('UPDATE public.users SET active=false WHERE id=$1',[user.id])
 try {await me(oldToken,401)} finally {await db.query('UPDATE public.users SET active=true WHERE id=$1',[user.id])}
 const payload=jwt.decode(oldToken)
 const expired=jwt.sign({...payload,exp:Math.floor(Date.now()/1000)-60},process.env.JWT_SECRET)
 await me(expired,401)
 const tenantTamper=jwt.sign({...payload,tenantId:fixture.otherTenantId},process.env.JWT_SECRET)
 await me(tenantTamper,401)
 const password=crypto.randomBytes(30).toString('base64url')+'aA1!'
 const reset=await admin.auth.admin.updateUserById(user.id,{password})
 if(reset.error)throw reset.error
 user.password=password
 await fs.writeFile(file,JSON.stringify(fixture,null,2),{mode:0o600})
 await me(oldToken,401)
 await me(await login(),200)
 console.log('PASS live metadata escalation denial, account deactivation, expired/tenant-tampered token denial and password-change invalidation/new sign-in')
}catch(error){console.error(error.message);process.exitCode=1}finally{await browser.auth.signOut();await db.end().catch(()=>{})}
