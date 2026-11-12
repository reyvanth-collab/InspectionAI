const assert=require('node:assert/strict'), fs=require('node:fs'), crypto=require('node:crypto')
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto'),{uuid_ossp}=require('@electric-sql/pglite/contrib/uuid_ossp')
require('express-async-errors')
process.env.JWT_SECRET=crypto.randomBytes(48).toString('base64url')
const dbModule=require('../dist/lib/db'),express=require('express')
;(async()=>{
  const db=new PGlite({extensions:{pgcrypto,uuid_ossp}})
  let server
  try {
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,encrypted_password text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;')
    await db.exec(fs.readFileSync('../supabase/schema.sql','utf8'))
    await db.exec('ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;CREATE TABLE public.inspectai_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now());ALTER TABLE public.inspectai_migrations ENABLE ROW LEVEL SECURITY;')
    const {migrationPlan}=await import('../scripts/migration-plan.mjs')
    const feature='20261112090000_approval_workflow_designer.sql'
    for(const name of migrationPlan(fs.readdirSync('../supabase/migrations'))) if(name!==feature) await db.exec(fs.readFileSync('../supabase/migrations/'+name,'utf8'))
    const tenant=crypto.randomUUID(),author=crypto.randomUUID(),reviewer=crypto.randomUUID()
    await db.query("INSERT INTO public.tenants(id,name,slug) VALUES($1,'Synthetic legacy workflow','synthetic-legacy-workflow')",[tenant])
    for(const [id,role] of [[author,'admin'],[reviewer,'approver']]) {
      await db.query("INSERT INTO auth.users(id,encrypted_password) VALUES($1,'synthetic')",[id])
      await db.query('INSERT INTO public.users(id,tenant_id,name,email,staff_id,role) VALUES($1,$2,$3,$4,$3,$5)',[id,tenant,role,role+'@legacy.invalid',role])
    }
    const fixtures=[]
    for(const [index,done] of [false,true].entries()) {
      const form=(await db.query("INSERT INTO public.work_instructions(tenant_id,wi_number,title,revision,owner_id,status) VALUES($1,$2,'Legacy approval revision','A',$3,'draft') RETURNING id",[tenant,'LEGACY-'+index,author])).rows[0]
      await db.query("INSERT INTO public.wi_checklist_items(tenant_id,work_instruction_id,item_no,description,field_type) VALUES($1,$2,'1','Preserved legacy question','pass_fail')",[tenant,form.id])
      const run=(await db.query(`INSERT INTO public.approval_records(tenant_id,work_instruction_id,submitted_by,current_step,final_status) VALUES($1,$2,$3,1,$4) RETURNING id`,[tenant,form.id,author,done?'done':'active'])).rows[0]
      const step=(await db.query("INSERT INTO public.approval_steps(tenant_id,approval_record_id,step_number,label,approver_id,status,comment) VALUES($1,$2,1,'Legacy one-step approval',$3,$4,$5) RETURNING id",[tenant,run.id,reviewer,done?'done':'active',done?'Original historical decision':null])).rows[0]
      await db.query('UPDATE public.work_instructions SET status=$1 WHERE id=$2',[done?'active':'pending_approval',form.id])
      fixtures.push({form:form.id,run:run.id,step:step.id})
    }
    const legacySql='SELECT id,approval_record_id,step_number,label,approver_id,status,comment,created_at,completed_at,decided_by FROM public.approval_steps ORDER BY id'
    const before=JSON.stringify((await db.query(legacySql)).rows)
    await db.exec(fs.readFileSync('../supabase/migrations/'+feature,'utf8'))
    assert.equal(JSON.stringify((await db.query(legacySql)).rows),before,'Migration must preserve every original step field')
    assert((await db.query('SELECT workflow_version_id,route_snapshot,submitted_snapshot FROM public.approval_records')).rows.every((row)=>row.workflow_version_id===null && row.route_snapshot===null && row.submitted_snapshot===null))
    assert((await db.query('SELECT group_rule,stage_size,skipped FROM public.approval_steps')).rows.every((row)=>row.group_rule==='any' && row.stage_size===1 && row.skipped===false))
    const protectedTables=['person_groups','person_group_members','approval_workflows','approval_workflow_versions','approval_reassignments']
    for(const table of protectedTables) {
      assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+table])).rows[0].relrowsecurity,true)
      assert.equal((await db.query("SELECT has_table_privilege('anon',$1,'SELECT') OR has_table_privilege('authenticated',$1,'SELECT') AS exposed",['public.'+table])).rows[0].exposed,false)
    }
    const query=(sql,params)=>db.query(sql,params)
    dbModule.pool.connect=async()=>({query,release(){}})
    dbModule.query=async(sql,params)=>{await db.query("SELECT set_config('app.actor_id',$1,false)",[require('../dist/lib/actor').actorContext.getStore() || '']);return query(sql,params)}
    await db.exec('SET ROLE inspectai_runtime')
    const app=express();app.use(express.json());app.use('/approvals',require('../dist/routes/approvals').default);app.use(require('../dist/middleware/errorHandler').errorHandler)
    server=app.listen(0,'127.0.0.1');await new Promise((resolve)=>server.once('listening',resolve))
    const token=require('../dist/lib/jwt').signToken({id:reviewer,tenantId:tenant,email:'approver@legacy.invalid',role:'approver',staffId:'approver',name:'approver',authVersion:crypto.createHash('sha256').update('synthetic').digest('hex')})
    const response=await fetch(`http://127.0.0.1:${server.address().port}/approvals/steps/${fixtures[0].step}/approve`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'})
    assert.equal(response.status,200,await response.text())
    assert.equal((await db.query('SELECT status FROM public.work_instructions WHERE id=$1',[fixtures[0].form])).rows[0].status,'active')
    const completed=(await db.query('SELECT comment,status FROM public.approval_steps WHERE id=$1',[fixtures[1].step])).rows[0]
    assert.equal(completed.comment,'Original historical decision');assert.equal(completed.status,'done')
    console.log('PASS workflow migration over pre-feature pending/completed approvals; historical fields and references preserved, legacy pending route completes, new tables enforce RLS and deny browser roles')
  } finally {server?.close();await db.close();await dbModule.pool.end()}
})().catch((error)=>{console.error(error);process.exitCode=1})
