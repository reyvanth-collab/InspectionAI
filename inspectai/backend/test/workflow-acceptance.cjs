const assert = require('node:assert/strict')
const crypto = require('node:crypto')

module.exports = async ({ call, db, users, tenant, generalDepartment, workflow, personGroup, workflowGraph, base, realPostgres=false }) => {
  let checks = 0, serial = 0
  const verify = (condition, message) => { assert(condition, message); checks++ }
  const groupBody = (memberIds, active = true) => ({ name: personGroup.name, description: 'Synthetic workflow acceptance', departmentId: generalDepartment, memberIds, active })
  const updateGroup = (memberIds, active = true) => call(200, '/approval-workflows/person-groups/' + personGroup.id, groupBody(memberIds,active), 'admin', 'PUT')
  async function form() {
    const body = { wiNumber: `WF-ACCEPT-${++serial}`, title: 'Synthetic approval route acceptance ' + serial, revision: 'A', departmentId: generalDepartment, checklistItems: [{ itemNo: '1', description: 'Verify synthetic signalling state', fieldType: 'pass_fail', required: true, sortOrder: 1 }] }
    return { ...(await call(201, '/work-instructions', body)), body }
  }
  async function submit(f) { await call(200, `/work-instructions/${f.id}/submit-approval`, { approverIds: [] }); return (await db.query('SELECT * FROM public.approval_records WHERE work_instruction_id=$1 ORDER BY submitted_at DESC', [f.id])).rows[0] }
  const steps = async (record) => (await db.query('SELECT * FROM public.approval_steps WHERE approval_record_id=$1 ORDER BY step_number,approver_id', [record.id])).rows
  async function draft(rule = 'any', isDefault = true) {
    const version = await call(201, `/approval-workflows/${workflow.workflowId}/draft`, {})
    const graph = JSON.parse(JSON.stringify(workflowGraph)); graph.nodes[1].groupRule = rule
    await call(200, `/approval-workflows/${workflow.workflowId}/versions/${version.id}`, { workflowCode: 'SIGNALLING-REVIEW', name: 'Signalling review', description: '', departmentId: generalDepartment, isDefault, graph }, 'admin','PUT')
    return version
  }
  const activate = (version) => call(200, `/approval-workflows/${workflow.workflowId}/versions/${version.id}/activate`, {})
  async function privileged(sql, params) {
    await db.exec('RESET ROLE')
    await db.query("SELECT set_config('app.actor_id',$1,false),set_config('app.change_reason','Synthetic acceptance access change',false)", [users.admin.id])
    try { return await db.query(sql,params) } finally { await db.exec('SET ROLE inspectai_runtime') }
  }
  const token = (role) => require('../dist/lib/jwt').signToken({ ...users[role], authVersion: crypto.createHash('sha256').update('unused').digest('hex') })
  const rawDecision = (stepId, role) => fetch(`${base}/approvals/steps/${stepId}/approve`, { method:'PATCH', headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(role)},body:'{}' })

  const listed = await call(200,'/approval-workflows/person-groups',undefined,'admin','GET')
  verify(listed.find((group) => group.id===personGroup.id).workflows.length > 0, 'Group lists workflow references')
  const originalMembers=listed.find((group)=>group.id===personGroup.id).members.map((member)=>member.id)
  const membershipSql='SELECT user_id,created_at FROM public.person_group_members WHERE person_group_id=$1 ORDER BY user_id'
  const beforeMemberships=JSON.stringify((await db.query(membershipSql,[personGroup.id])).rows)
  await updateGroup(originalMembers)
  verify(JSON.stringify((await db.query(membershipSql,[personGroup.id])).rows)===beforeMemberships,'Saving an unchanged membership preserves its timestamps and provenance')
  await call(200,'/approval-workflows',undefined,'otherAdmin','GET').then((rows) => verify(rows.length===0,'Other tenant cannot list workflow versions'))
  await call(404,`/approval-workflows/${workflow.workflowId}/versions/${workflow.id}/preview`,{},'otherAdmin')
  await call(400,'/approval-workflows/person-groups',{ name:'Foreign member denied',memberIds:[users.otherAdmin.id] })
  await call(404,'/approval-workflows/person-groups/'+personGroup.id,{...groupBody([]),departmentId:null},'otherAdmin','PUT')
  await call(200,`/approval-workflows/default?departmentId=${generalDepartment}`,undefined,'author','GET')
  await call(403,'/approval-workflows',undefined,'author','GET')

  // Confirmation is bound to membership and the saved revision, even without a client refresh.
  const stale = await form()
  const preview = await call(200,`/work-instructions/${stale.id}/approval-preview`,{approverIds:[]})
  await updateGroup([users.approver.id,users.replacement.id])
  await call(409,`/work-instructions/${stale.id}/submit-approval`,{approverIds:[],confirmationToken:preview.confirmationToken})
  const contentPreview = await call(200,`/work-instructions/${stale.id}/approval-preview`,{approverIds:[]})
  await call(200,`/work-instructions/${stale.id}`,{...stale.body,title:'Updated synthetic content'},'admin','PUT')
  await call(409,`/work-instructions/${stale.id}/submit-approval`,{approverIds:[],confirmationToken:contentPreview.confirmationToken})

  const frozen = await form(), frozenRun = await submit(frozen)
  const originalSnapshot = JSON.stringify(frozenRun.route_snapshot)
  const next = await draft('all')
  verify((await db.query('SELECT status FROM public.approval_workflow_versions WHERE id=$1',[workflow.id])).rows[0].status==='active','Editing active route creates a separate draft')
  await activate(next)
  await updateGroup([users.replacement.id],false)
  await call(400,`/work-instructions/${stale.id}/approval-preview`,{approverIds:[]})
  let assigned = await steps(frozenRun)
  await call(403,`/approvals/steps/${assigned[0].id}/approve`,{comment:'No workflow administrator substitution'},'admin','PATCH')
  const first = assigned.find((step)=>step.step_number===1 && step.approver_id===users.approver.id)
  await call(200,`/approvals/steps/${first.id}/approve`,{},'approver','PATCH')
  assigned = await steps(frozenRun)
  verify(assigned.filter((step)=>step.step_number===1 && step.skipped).length===1,'Any stage closes remaining candidate task despite later group deactivation')
  await call(200,`/approvals/steps/${assigned.find((step)=>step.step_number===2).id}/approve`,{},'manager','PATCH')
  verify(JSON.stringify((await db.query('SELECT route_snapshot FROM public.approval_records WHERE id=$1',[frozenRun.id])).rows[0].route_snapshot)===originalSnapshot,'Saved run unaffected by new workflow version and membership changes')
  await updateGroup([users.approver.id,users.replacement.id])

  const allForm = await form(), allRun = await submit(allForm)
  assigned = await steps(allRun)
  verify(assigned.filter((step)=>step.step_number===1 && step.status==='active' && step.group_rule==='all').length===2,'All stage resolves both eligible members')
  await call(200,`/approvals/steps/${assigned.find((step)=>step.step_number===1 && step.approver_id===users.approver.id).id}/approve`,{},'approver','PATCH')
  verify((await steps(allRun)).find((step)=>step.step_number===2).status==='wait','All does not advance after one approval')
  await call(200,`/approvals/steps/${assigned.find((step)=>step.step_number===1 && step.approver_id===users.replacement.id).id}/approve`,{},'replacement','PATCH')
  const managerTask = (await steps(allRun)).find((step)=>step.step_number===2)
  await privileged('UPDATE public.users SET active=false WHERE id=$1',[users.manager.id])
  const blocked = (await call(200,'/approvals',undefined,'admin','GET')).find((record)=>record.id===allRun.id)
  verify(blocked.stage_blocked && blocked.approval_steps.find((step)=>step.id===managerTask.id).eligible===false,'Lost reviewer access exposes a blocked stage and its assignment')
  await call(400,`/approvals/steps/${managerTask.id}/reassign`,{reviewerId:users.replacement.id,reason:''})
  await call(400,`/approvals/steps/${managerTask.id}/reassign`,{reviewerId:users.admin.id,reason:'Self review denied'})
  await call(403,`/approvals/steps/${managerTask.id}/reassign`,{reviewerId:users.replacement.id,reason:'Not an administrator'},'approver')
  await call(200,`/approvals/steps/${managerTask.id}/reassign`,{reviewerId:users.replacement.id,reason:'Synthetic manager access loss; independent departmental replacement'})
  const history = (await db.query('SELECT * FROM public.approval_reassignments WHERE step_id=$1',[managerTask.id])).rows
  verify(history.length===1 && history[0].previous_reviewer_id===users.manager.id,'Reassignment has immutable previous reviewer, replacement, actor and reason')
  await assert.rejects(()=>db.query("UPDATE public.approval_reassignments SET reason='tampered' WHERE step_id=$1",[managerTask.id]),/permission denied/i)
  checks++
  verify((await steps(allRun)).find((step)=>step.id===managerTask.id).stage_size===1,'Reassignment preserves required stage count')
  await call(200,`/approvals/steps/${managerTask.id}/approve`,{},'replacement','PATCH')
  const retry = await call(200,`/approvals/steps/${managerTask.id}/approve`,{},'replacement','PATCH')
  verify(retry.alreadyDecided,'Decision retry is idempotent')
  verify((await db.query('SELECT count(*)::int n FROM public.wi_revision_history WHERE work_instruction_id=$1',[allForm.id])).rows[0].n===1,'Exact revision publishes once')
  await privileged('UPDATE public.users SET active=true WHERE id=$1',[users.manager.id])

  const returned = await form(), rejectedRun = await submit(returned)
  assigned = await steps(rejectedRun)
  const rejection = assigned.find((step)=>step.step_number===1 && step.approver_id===users.approver.id)
  await call(400,`/approvals/steps/${rejection.id}/reject`,{},'approver','PATCH')
  await call(200,`/approvals/steps/${rejection.id}/reject`,{comment:'Synthetic return: clarify the acceptance criterion'},'approver','PATCH')
  verify((await steps(rejectedRun)).every((step)=>step.status==='rejected' || step.skipped),'Rejection closes every pending task')
  await call(200,`/work-instructions/${returned.id}`,{...returned.body,title:'Corrected synthetic revision'},'admin','PUT')
  const resubmitted = await submit(returned)
  verify(resubmitted.id!==rejectedRun.id,'Resubmission creates a new run')
  const previous = (await db.query('SELECT * FROM public.approval_records WHERE id=$1',[rejectedRun.id])).rows[0]
  verify(previous.submitted_snapshot.form.title===returned.body.title && previous.final_status==='rejected','Prior rejected content snapshot and history survive resubmission')

  // A contributor is filtered out, even when membership in the group is allowed.
  await updateGroup([users.admin.id,users.approver.id])
  const independent = await form(), independentRun = await submit(independent)
  verify(!(await steps(independentRun)).some((step)=>step.approver_id===users.admin.id),'Group membership cannot route the form to its author')
  await updateGroup([users.approver.id,users.replacement.id])

  const concurrentAll = await form(), concurrentAllRun = await submit(concurrentAll)
  assigned = await steps(concurrentAllRun)
  const responses = await Promise.all(assigned.filter((step)=>step.step_number===1).map((step)=>rawDecision(step.id,step.approver_id===users.approver.id?'approver':'replacement')))
  verify(responses.every((response)=>response.status===200),'Concurrent All decisions are accepted')
  verify((await steps(concurrentAllRun)).filter((step)=>step.step_number===2 && step.status==='active').length===1,'Concurrent All stage advances once')
  const concurrentFinal = (await steps(concurrentAllRun)).find((step)=>step.step_number===2)
  const finalResponses = await Promise.all([rawDecision(concurrentFinal.id,'manager'),rawDecision(concurrentFinal.id,'manager')])
  verify(finalResponses.every((response)=>response.status===200),'Concurrent final retries succeed idempotently')
  verify((await db.query('SELECT count(*)::int n FROM public.wi_revision_history WHERE work_instruction_id=$1',[concurrentAll.id])).rows[0].n===1,'Concurrent final retry publishes exactly once')

  const anyVersion = await draft('any'); await activate(anyVersion)
  const concurrentAny = await form(), concurrentAnyRun = await submit(concurrentAny)
  assigned = await steps(concurrentAnyRun)
  const anyResponses = await Promise.all(assigned.filter((step)=>step.step_number===1).map((step)=>rawDecision(step.id,step.approver_id===users.approver.id?'approver':'replacement')))
  verify(anyResponses.map((response)=>response.status).sort().join(',')==='200,409','Concurrent Any decisions have one winner and close the other task')
  verify((await steps(concurrentAnyRun)).filter((step)=>step.step_number===1 && step.status==='done').length===1,'Any stage records one approval')
  const outsideDepartment = crypto.randomUUID()
  await privileged("INSERT INTO public.departments(id,tenant_id,code,name) VALUES($1,$2,'WF-OUTSIDE','Synthetic outside department')",[outsideDepartment,tenant])
  await privileged('UPDATE public.users SET primary_department_id=$1 WHERE id=$2',[outsideDepartment,users.replacement.id])
  await privileged('DELETE FROM public.department_memberships WHERE user_id=$1 AND department_id=$2',[users.replacement.id,generalDepartment])
  await call(400,'/approval-workflows/person-groups/'+personGroup.id,groupBody([users.replacement.id]),'admin','PUT')
  await call(404,`/approval-workflows/default?departmentId=${outsideDepartment}`,undefined,'author','GET')
  await call(404,'/work-instructions/'+concurrentAny.id,undefined,'replacement','GET')
  await privileged('UPDATE public.users SET primary_department_id=$1 WHERE id=$2',[generalDepartment,users.replacement.id])
  await privileged('DELETE FROM public.department_memberships WHERE user_id=$1 AND department_id=$2',[users.replacement.id,outsideDepartment])
  const conflicting = await call(201,'/approval-workflows',{ workflowCode:'CONFLICTING-DEFAULT',name:'Conflicting default',description:'',departmentId:generalDepartment,isDefault:true,graph:workflowGraph })
  await call(409,`/approval-workflows/${conflicting.workflowId}/versions/${conflicting.id}/activate`,{})
  await assert.rejects(()=>db.query("UPDATE public.approval_workflow_versions SET graph='{}' WHERE id=$1",[anyVersion.id]),/draft version/)
  await assert.rejects(()=>db.query("UPDATE public.approval_records SET route_snapshot='{}' WHERE id=$1",[frozenRun.id]),/immutable/)
  checks+=2
  const noDefault = await draft('any',false); await activate(noDefault)
  console.log(`PASS ${checks} workflow version, group, confirmation, blocked reassignment, rejection/history, independence and concurrent-request assertions (${realPostgres?'real PostgreSQL with independent connections':'PGlite leases serialize transactions'})`)
}
