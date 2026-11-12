const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const { chromium, expect } = require('../../frontend/node_modules/@playwright/test')

// Real built React UI + real Express routes + migrated local test database.
// Only the external Supabase password exchange is substituted for generated synthetic users.
module.exports = async ({ base, db, users, generalDepartment, passwordAuth }) => {
  const fixturePassword = crypto.randomBytes(30).toString('base64url')
  await db.exec('RESET ROLE')
  await db.query("UPDATE public.tenants SET name='Synthetic workflow acceptance — not operational' WHERE id=$1",[users.admin.tenantId])
  await db.exec('SET ROLE inspectai_runtime')
  const originalAuth = passwordAuth.authenticatePassword
  passwordAuth.authenticatePassword = async (email,password) => password===fixturePassword ? Object.values(users).find((user)=>user.email===email)?.id || null : null
  const frontend = express()
  frontend.use('/api',express.json(),async (req,res,next) => {
    try {
      const response = await fetch(base+req.url,{method:req.method,headers:{'Content-Type':'application/json',...(req.headers.authorization?{Authorization:req.headers.authorization}:{})},...(['GET','HEAD'].includes(req.method)?{}:{body:JSON.stringify(req.body)})})
      res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(Buffer.from(await response.arrayBuffer()))
    } catch(error) { next(error) }
  })
  const dist = path.resolve('../frontend/dist')
  assert(fs.existsSync(path.join(dist,'index.html')),'Build frontend before running the workflow browser acceptance')
  frontend.use(express.static(dist)); frontend.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')))
  const server = frontend.listen(0,'127.0.0.1'); await new Promise((resolve)=>server.once('listening',resolve))
  const origin = 'http://127.0.0.1:'+server.address().port
  let browser
  const pages = []
  let checks = 0, serial = 0
  const check = (condition,message) => { assert(condition,message); checks++ }
  async function login(role) {
    const context = await browser.newContext({viewport:{width:1600,height:1000}})
    const page = await context.newPage(); pages.push(page)
    page.setDefaultTimeout(12000)
    await page.goto(origin+'/login'); await page.getByLabel('Email',{exact:true}).fill(users[role].email)
    await page.getByLabel('Password',{exact:true}).fill(fixturePassword)
    await page.getByRole('button',{name:'Sign in',exact:true}).click()
    await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible()
    return page
  }
  async function api(page,method,url,body) {
    return page.evaluate(async ({method,url,body})=>{
      const response=await fetch('/api'+url,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('inspectai-jwt')},...(body===undefined?{}:{body:JSON.stringify(body)})})
      return {status:response.status,payload:await response.json()}
    },{method,url,body})
  }
  async function routePreview(page,order) {
    await page.getByRole('button',{name:'Preview route',exact:true}).click()
    const modal=page.getByRole('dialog',{name:'Workflow route preview'})
    for(let index=0;index<order.length;index++) await expect(modal.locator('.wf-preview-item').nth(index)).toContainText(order[index])
    return modal
  }
  async function connect(page,source,target,drag=false) {
    await page.getByRole('button',{name:'Fit workflow to canvas'}).click()
    const output=page.getByRole('button',{name:'Connect from '+source,exact:true}), input=page.getByRole('button',{name:'Connect into '+target,exact:true})
    if(!drag){ await output.click(); await input.click(); return }
    await output.scrollIntoViewIfNeeded(); const a=await output.boundingBox(), b=await input.boundingBox()
    assert(a&&b,'Connection handles must be visible')
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2); await page.mouse.down()
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12}); await page.mouse.up()
  }
  async function approvalPage(page,formId) {
    await page.goto(origin+'/library/'+formId)
    await page.getByRole('tab',{name:'Approval & comments'}).click()
    await expect(page.getByRole('region',{name:'Approval progress'})).toBeVisible()
  }
  async function createForm(admin) {
    const response=await api(admin,'POST','/work-instructions',{wiNumber:'WF-BROWSER-'+(++serial),title:'Synthetic browser approval '+serial,revision:'A',departmentId:generalDepartment,checklistItems:[{itemNo:'1',description:'Confirm synthetic signalling state',fieldType:'pass_fail',required:true,sortOrder:1}]})
    check(response.status===201,'Synthetic form fixture created through permission-enforced API')
    return response.payload.data
  }
  async function submit(admin,formId) {
    await admin.goto(origin+'/library/'+formId+'/edit')
    await admin.getByRole('button',{name:'Submit for Approval',exact:true}).click()
    await expect(admin.getByRole('dialog')).toContainText('Browser signalling approval')
    await admin.getByRole('button',{name:'Continue to confirmation',exact:true}).click()
    const confirm=admin.getByRole('dialog',{name:'Confirm submission for approval'})
    await expect(confirm).toBeVisible(); await expect(confirm.getByRole('button',{name:'Preview form',exact:true})).toBeVisible()
    await expect(confirm.getByRole('button',{name:'Keep editing',exact:true})).toBeVisible()
    await expect(confirm).toContainText('Engineering Manager')
    await confirm.getByRole('button',{name:'Submit for approval',exact:true}).click()
    await expect(admin).toHaveURL(origin+'/library/'+formId)
  }
  async function inboxContains(page,formId) {
    const response=await api(page,'GET','/work-instructions?needsApproval=true')
    assert.equal(response.status,200)
    return response.payload.data.some((form)=>form.id===formId)
  }
  async function approve(page,formId) {
    await approvalPage(page,formId)
    await page.getByRole('button',{name:'Approve form',exact:true}).click()
    await expect(page.getByRole('button',{name:'Approve form',exact:true})).toHaveCount(0)
  }
  async function accessChange(userId,active) {
    await db.exec('RESET ROLE')
    await db.query("SELECT set_config('app.actor_id',$1,false),set_config('app.change_reason','Synthetic browser access-loss scenario',false)",[users.admin.id])
    await db.query('UPDATE public.users SET active=$1 WHERE id=$2',[active,userId]); await db.exec('SET ROLE inspectai_runtime')
  }
  try {
    if(process.env.INSPECTAI_WORKFLOW_PREVIEW==='1') {
      fs.mkdirSync('.env.workflow-browser',{recursive:true})
      const credentialsPath=path.resolve('.env.workflow-browser/credentials.json')
      fs.writeFileSync(credentialsPath,JSON.stringify({url:origin,synthetic:true,personas:Object.fromEntries(['admin','author','approver','replacement','manager'].map((role)=>[role,{email:users[role].email,password:fixturePassword}]))},null,2),{mode:0o600})
      console.log(`Synthetic workflow preview: ${origin}\nGenerated credentials are in the ignored file ${credentialsPath}\nThis in-memory preview does not connect to a hosted database. Stop with Ctrl+C; its synthetic records are discarded.`)
      await new Promise((resolve)=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)})
      return
    }
    browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || (process.platform==='win32'?'chrome':undefined),headless:true})
    const admin=await login('admin')
    await admin.goto(origin+'/settings?tab=users&section=groups')
    await admin.getByRole('button',{name:'Create Person Group',exact:true}).click()
    await admin.getByLabel('Group name',{exact:true}).fill('Browser Signalling Reviewers')
    await admin.getByLabel('Group department').selectOption(generalDepartment)
    await admin.getByRole('checkbox',{name:/approver@test.invalid/}).check()
    await admin.getByRole('checkbox',{name:/replacement@test.invalid/}).check()
    await admin.getByRole('button',{name:'Save group',exact:true}).click()
    await expect(admin.getByRole('dialog')).toHaveCount(0)
    await admin.getByLabel('Search Person Groups').fill('Browser Signalling')
    await expect(admin.getByRole('status')).toHaveText('1 matching groups')
    const groups=(await api(admin,'GET','/approval-workflows/person-groups')).payload.data
    const group=groups.find((item)=>item.name==='Browser Signalling Reviewers')
    check(group.active_member_count===2 && group.department_id===generalDepartment,'Dedicated group page saves scoped membership')

    await admin.goto(origin+'/approval-workflows')
    await admin.getByRole('button',{name:'New workflow',exact:true}).click()
    const createDialog=admin.getByRole('dialog',{name:'Create approval workflow'})
    await createDialog.getByLabel('Workflow code').fill('BROWSER-RAIL')
    await createDialog.getByLabel('Workflow name').fill('Browser signalling approval')
    await createDialog.getByLabel('Applies to').selectOption(generalDepartment)
    await createDialog.getByRole('checkbox',{name:'Default for this scope',exact:true}).check()
    await createDialog.getByRole('button',{name:'Create draft',exact:true}).click()
    const positions=[{x:100,y:100},{x:360,y:100},{x:620,y:350},{x:100,y:350}]
    for(const [index,title] of ['Start','Group Approval','Individual Approval','Publish'].entries()) {
      await admin.locator('.wf-palette-row').filter({hasText:title}).dragTo(admin.locator('.wf-viewport'),{targetPosition:positions[index]})
      await expect(admin.locator('.wf-node')).toHaveCount(index+1)
    }
    await admin.getByRole('button',{name:'Fit workflow to canvas'}).click()
    await admin.getByRole('group',{name:/Group Approval node/}).click()
    await admin.getByLabel('Stage name').fill('Signalling Reviewer Group')
    await admin.getByLabel('Person Group').selectOption(group.id)
    await admin.getByLabel('Approval rule').selectOption('any')
    await admin.getByRole('group',{name:/Individual Approval node/}).click()
    await admin.getByLabel('Stage name').fill('Engineering Manager')
    await admin.getByLabel('Named reviewer').selectOption(users.manager.id)
    await admin.getByRole('button',{name:'Fit workflow to canvas'}).click()
    await connect(admin,'Start','Signalling Reviewer Group',true)
    await connect(admin,'Signalling Reviewer Group','Engineering Manager',true)
    await connect(admin,'Engineering Manager','Publish',true)
    await expect(admin.locator('.wf-edge-remove')).toHaveCount(3)
    await admin.getByRole('button',{name:'Save draft',exact:true}).click()
    await expect(admin.getByText('All changes saved',{exact:true})).toBeVisible()
    const saved=(await api(admin,'GET','/approval-workflows')).payload.data.find((version)=>version.workflow_code==='BROWSER-RAIL')
    await admin.reload()
    const reopened=(await api(admin,'GET','/approval-workflows')).payload.data.find((version)=>version.version_id===saved.version_id)
    check(JSON.stringify(reopened.graph)===JSON.stringify(saved.graph),'Browser save/reopen preserves graph and positions')
    await admin.getByRole('button',{name:'Fit workflow to canvas'}).click()
    const managerNode=admin.getByRole('group',{name:'Individual Approval node Engineering Manager'})
    const header=await managerNode.locator('.wf-node-head').boundingBox(); assert(header)
    await admin.mouse.move(header.x+40,header.y+20); await admin.mouse.down(); await admin.mouse.move(header.x+75,header.y+70,{steps:10}); await admin.mouse.up()
    let modal=await routePreview(admin,['Start','Signalling Reviewer Group','Engineering Manager','Publish'])
    await modal.getByRole('button',{name:'Continue editing'}).click()
    const moved=(await api(admin,'GET','/approval-workflows')).payload.data.find((version)=>version.version_id===saved.version_id)
    check(moved.graph.nodes.find((node)=>node.type==='individual').x!==saved.graph.nodes.find((node)=>node.type==='individual').x,'Moving a node saves its changed position without changing route order')
    for(const connection of ['Start to Signalling Reviewer Group','Signalling Reviewer Group to Engineering Manager','Engineering Manager to Publish']) await admin.getByRole('button',{name:'Remove connection from '+connection,exact:true}).click()
    await connect(admin,'Start','Engineering Manager'); await connect(admin,'Engineering Manager','Signalling Reviewer Group'); await connect(admin,'Signalling Reviewer Group','Publish')
    modal=await routePreview(admin,['Start','Engineering Manager','Signalling Reviewer Group','Publish']); await modal.getByRole('button',{name:'Continue editing'}).click()
    for(const connection of ['Start to Engineering Manager','Engineering Manager to Signalling Reviewer Group','Signalling Reviewer Group to Publish']) await admin.getByRole('button',{name:'Remove connection from '+connection,exact:true}).click()
    await connect(admin,'Start','Signalling Reviewer Group'); await connect(admin,'Signalling Reviewer Group','Engineering Manager'); await connect(admin,'Engineering Manager','Publish')
    modal=await routePreview(admin,['Start','Signalling Reviewer Group','Engineering Manager','Publish']); await modal.getByRole('button',{name:'Activate version',exact:true}).click()
    await expect(modal).toHaveCount(0)
    fs.mkdirSync('.env.workflow-browser',{recursive:true}); await admin.screenshot({path:'.env.workflow-browser/designer.png',fullPage:true})

    const reviewer=await login('approver'), manager=await login('manager'), replacement=await login('replacement'), author=await login('author')
    const f=await createForm(author); await submit(author,f.id)
    check(await inboxContains(reviewer,f.id),'Group receives initial approval inbox task')
    check(!await inboxContains(manager,f.id),'Manager has no inbox task before group approval')
    await approvalPage(admin,f.id); await expect(admin.getByRole('button',{name:'Approve form',exact:true})).toHaveCount(0)
    await admin.goto(origin+'/settings?tab=users&section=groups')
    await admin.getByRole('button',{name:'Manage '+group.name,exact:true}).click()
    await admin.getByRole('checkbox',{name:/approver@test.invalid/}).uncheck()
    await admin.getByRole('checkbox',{name:'Group active',exact:true}).uncheck()
    await admin.getByRole('button',{name:'Save group',exact:true}).click()
    await expect(admin.getByRole('dialog')).toHaveCount(0)
    await expect(admin.getByRole('row').filter({hasText:group.name})).toContainText('Inactive')
    await expect(admin.getByRole('row').filter({hasText:group.name})).toContainText('BROWSER-RAIL')
    await approve(reviewer,f.id)
    check(!await inboxContains(replacement,f.id),'Any approval closes remaining group inbox task')
    check(await inboxContains(manager,f.id),'Manager receives task only after group stage passes')
    check((await api(admin,'GET','/work-instructions/'+f.id)).payload.data.status==='pending_approval','Revision remains unpublished before manager approval')
    await approve(manager,f.id)
    check((await api(admin,'GET','/work-instructions/'+f.id)).payload.data.status==='active','Manager decision publishes the submitted revision')
    await api(admin,'PUT','/approval-workflows/person-groups/'+group.id,{name:group.name,description:'Synthetic browser group',departmentId:generalDepartment,active:true,memberIds:[users.approver.id,users.replacement.id]})
    const completed=(await api(admin,'GET','/approvals')).payload.data.find((record)=>record.wi_id===f.id)
    check(completed.submitted_snapshot.form.revision==='A' && completed.final_status==='done','Completed run keeps exact submitted revision snapshot')

    // Edit the active route through its draft-version UI and verify All plus blocked reassignment.
    await admin.goto(origin+'/approval-workflows'); await admin.getByLabel('Workflow version').selectOption(saved.version_id)
    await admin.getByRole('button',{name:'Edit active version',exact:true}).click()
    await admin.getByRole('group',{name:'Group Approval node Signalling Reviewer Group'}).click(); await admin.getByLabel('Approval rule').selectOption('all')
    modal=await routePreview(admin,['Start','Signalling Reviewer Group','Engineering Manager','Publish'])
    await expect(modal).toContainText('All eligible members'); await modal.getByRole('button',{name:'Activate version',exact:true}).click()
    const allForm=await createForm(author); await submit(author,allForm.id)
    await approve(reviewer,allForm.id); check(!await inboxContains(manager,allForm.id),'All waits after only one member approval')
    await approve(replacement,allForm.id); check(await inboxContains(manager,allForm.id),'All advances after both assigned members approve')
    await accessChange(users.manager.id,false)
    await approvalPage(admin,allForm.id)
    await expect(admin.getByRole('alert').filter({hasText:'This stage is blocked'})).toBeVisible()
    await admin.getByRole('button',{name:'Reassign unavailable reviewer',exact:true}).click()
    await admin.getByLabel('Replacement reviewer').selectOption(users.replacement.id)
    await admin.getByLabel('Reason for reassignment').fill('Synthetic manager access loss; replace the pending slot')
    await admin.getByRole('button',{name:'Confirm reassignment'}).click()
    await expect(admin.getByRole('dialog')).toHaveCount(0)
    await approve(replacement,allForm.id)
    check((await api(admin,'GET','/work-instructions/'+allForm.id)).payload.data.status==='active','Reasoned browser reassignment unblocks publication')
    await accessChange(users.manager.id,true)

    const returned=await createForm(author); await submit(author,returned.id)
    await approvalPage(reviewer,returned.id)
    await reviewer.getByLabel('Review comment',{exact:true}).fill('Synthetic rejection: clarify the criterion')
    await reviewer.getByRole('button',{name:'Reject with comment'}).click()
    await expect(reviewer.getByRole('button',{name:'Reject with comment'})).toHaveCount(0)
    await submit(author,returned.id)
    const runs=(await api(admin,'GET','/approvals')).payload.data.filter((record)=>record.wi_id===returned.id)
    check(runs.length===2 && runs.some((run)=>run.final_status==='rejected') && runs.some((run)=>run.final_status==='active'),'Browser rejection/resubmission retains both approval runs')

    const foreign=await login('otherAdmin'); await foreign.goto(origin+'/settings?tab=users&section=groups')
    await expect(foreign.getByText('Browser Signalling Reviewers',{exact:true})).toHaveCount(0)
    check((await api(foreign,'GET','/approval-workflows')).payload.data.length===0,'Other tenant administrator cannot see these workflows')
    console.log(`PASS ${checks} real-backend browser assertions: normal synthetic login, Person Groups, native drag/drop and handle drawing, graph persistence/movement/reconnection, Any/All execution, blocked reassignment, rejection/resubmission and tenant isolation`)
  } catch(error) {
    fs.mkdirSync('.env.workflow-browser',{recursive:true})
    for(const [index,page] of pages.entries()) await page.screenshot({path:`.env.workflow-browser/failure-${index}.png`,fullPage:true}).catch(()=>{})
    throw error
  } finally {
    passwordAuth.authenticatePassword=originalAuth
    await browser?.close(); server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve))
  }
}
