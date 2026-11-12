const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto')
const {Client,Pool}=require('pg')
require('express-async-errors')
process.env.JWT_SECRET=crypto.randomBytes(48).toString('base64url')
const url=process.env.WORKFLOW_TEST_DATABASE_URL
if(!url) throw new Error('Set WORKFLOW_TEST_DATABASE_URL to a fresh local inspectai_workflow_test database')
const target=new URL(url)
if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.pathname!=='/inspectai_workflow_test') throw new Error('This test only accepts a local disposable database named inspectai_workflow_test')
const express=require('express'),dbModule=require('../dist/lib/db'),jwt=require('../dist/lib/jwt')
;(async()=>{
  const fixture=new Client({connectionString:url}),appPool=new Pool({connectionString:url,max:12,application_name:'inspectai-workflow-concurrency-test'})
  await fixture.connect()
  let server
  const db={query:(sql,params)=>fixture.query(sql,params),exec:(sql)=>fixture.query(sql)}
  try {
    assert.equal((await fixture.query("SELECT to_regclass('public.tenants') AS existing")).rows[0].existing,null,'Use a fresh disposable database; existing data will not be reset')
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,encrypted_password text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;')
    await db.exec(fs.readFileSync('../supabase/schema.sql','utf8'))
    await db.exec('ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;CREATE TABLE public.inspectai_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now());ALTER TABLE public.inspectai_migrations ENABLE ROW LEVEL SECURITY;')
    const {migrationPlan}=await import('../scripts/migration-plan.mjs')
    for(const name of migrationPlan(fs.readdirSync('../supabase/migrations'))) await db.exec(fs.readFileSync('../supabase/migrations/'+name,'utf8'))
    const tenant=crypto.randomUUID(),otherTenant=crypto.randomUUID(),users={}
    for(const [id,name,slug] of [[tenant,'Synthetic workflow acceptance — not operational','workflow-pg'],[otherTenant,'Synthetic other tenant','workflow-pg-other']]) await fixture.query('INSERT INTO public.tenants(id,name,slug) VALUES($1,$2,$3)',[id,name,slug])
    for(const key of ['admin','approver','manager','replacement','author','otherAdmin']) {
      const role=key==='admin'||key==='otherAdmin'?'admin':'approver'
      users[key]={id:crypto.randomUUID(),tenantId:key==='otherAdmin'?otherTenant:tenant,role,email:key+'@test.invalid',name:key==='manager'?'Engineering Manager':key==='replacement'?'Replacement Reviewer':key,staffId:key}
      const user=users[key]
      await fixture.query("INSERT INTO auth.users(id,encrypted_password) VALUES($1,'unused')",[user.id])
      await fixture.query('INSERT INTO public.users(id,tenant_id,name,email,staff_id,role) VALUES($1,$2,$3,$4,$5,$6)',[user.id,user.tenantId,user.name,user.email,user.staffId,user.role])
    }
    await fixture.query("UPDATE public.users SET capabilities=ARRAY['form_author','viewer'] WHERE id=$1",[users.author.id])
    const generalDepartment=(await fixture.query("SELECT id FROM public.departments WHERE tenant_id=$1 AND code='GENERAL'",[tenant])).rows[0].id
    await fixture.query("SELECT set_config('app.actor_id',$1,false)",[users.admin.id]);await fixture.query('SET ROLE inspectai_runtime')
    // Each HTTP transaction receives a separate real PostgreSQL connection. No test mutex.
    dbModule.pool.connect=async()=>{const client=await appPool.connect();await client.query('SET ROLE inspectai_runtime');return client}
    const app=express();app.use(express.json())
    for(const [route,file] of [['auth','auth'],['work-instructions','workInstructions'],['approvals','approvals'],['approval-workflows','approvalWorkflows'],['departments','departments'],['users','users']]) app.use('/'+route,require('../dist/routes/'+file).default)
    app.use(require('../dist/middleware/errorHandler').errorHandler)
    server=app.listen(0,'127.0.0.1');await new Promise((resolve)=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port
    async function call(status,path,body,role='admin',method='POST') {
      if(status===200 && method==='POST' && path.endsWith('/submit-approval') && !body?.confirmationToken){const preview=await call(200,path.replace('/submit-approval','/approval-preview'),body,role);body={...body,confirmationToken:preview.confirmationToken}}
      const token=jwt.signToken({...users[role],authVersion:crypto.createHash('sha256').update('unused').digest('hex')})
      const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})})
      const result=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(result)}`);return result.data
    }
    const personGroup=await call(201,'/approval-workflows/person-groups',{name:'Signalling Reviewer Group',memberIds:[users.approver.id,users.manager.id]})
    const workflowGraph={nodes:[{id:'start',type:'start',label:'Start',x:10,y:100},{id:'signalling',type:'group',label:'Signalling Reviewer Group',personGroupId:personGroup.id,groupRule:'any',x:280,y:100},{id:'engineering',type:'individual',label:'Engineering Manager',reviewerId:users.manager.id,x:550,y:100},{id:'publish',type:'publish',label:'Publish',x:820,y:100}],edges:[{id:'a',source:'start',target:'signalling'},{id:'b',source:'signalling',target:'engineering'},{id:'c',source:'engineering',target:'publish'}]}
    const workflow=await call(201,'/approval-workflows',{workflowCode:'SIGNALLING-REVIEW',name:'Signalling review',description:'',departmentId:generalDepartment,isDefault:true,graph:workflowGraph})
    await call(200,`/approval-workflows/${workflow.workflowId}/versions/${workflow.id}/activate`,{})
    await require('./workflow-acceptance.cjs')({call,db,users,tenant,generalDepartment,workflow,personGroup,workflowGraph,base,realPostgres:true})
    assert(appPool.totalCount>=2,'Concurrency acceptance must use multiple PostgreSQL connections')
    if(process.env.WORKFLOW_TEST_BROWSER==='1') await require('./workflow-browser.cjs')({base,db,users,generalDepartment,passwordAuth:require('../dist/lib/passwordAuth')})
    console.log('PASS real PostgreSQL migration, isolation and concurrent Any/All/final retry checks with independent database connections')
  } finally {server?.closeAllConnections();if(server)await new Promise((resolve)=>server.close(resolve));await appPool.end();await fixture.end();await dbModule.pool.end()}
})().catch((error)=>{console.error(error);process.exitCode=1})
