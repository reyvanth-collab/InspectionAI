import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { beginActorTransaction, pool, query } from '../lib/db'
import { auditLog } from '../lib/events'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { validateWorkflowGraph, type WorkflowGraph, type WorkflowIssue, type WorkflowNode } from '../lib/approvalWorkflow'

const router = Router()
router.use(requireAuth)
router.use((req,res,next) => requireCapability(req.method==='GET' && ['/default','/available'].includes(req.path) ? 'form_author' : 'administrator')(req,res,next))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEPARTMENT_RE = UUID_RE

function graphInput(value: unknown): { graph: WorkflowGraph; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { graph: { nodes: [], edges: [] }, error: 'Workflow route must contain nodes and connections.' }
  const graph = value as Record<string, unknown>
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return { graph: { nodes: [], edges: [] }, error: 'Workflow route must contain nodes and connections.' }
  if (graph.nodes.length > 80 || graph.edges.length > 80)
    return { graph: { nodes: [], edges: [] }, error: 'A workflow can contain at most 80 nodes and 80 connections.' }
  return { graph: graph as unknown as WorkflowGraph }
}

router.get('/person-groups', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT g.id,g.name,g.description,g.active,g.department_id,d.name AS department_name,g.created_at,
              (SELECT count(*)::int FROM public.person_group_members m JOIN public.users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id WHERE m.person_group_id=g.id AND m.tenant_id=g.tenant_id AND u.active) AS active_member_count,
              COALESCE((SELECT json_agg(json_build_object('workflowId',w.id,'code',w.workflow_code,'version',v.version_number,'status',v.status,'name',v.name) ORDER BY w.workflow_code,v.version_number)
                FROM public.approval_workflow_versions v JOIN public.approval_workflows w ON w.id=v.workflow_id AND w.tenant_id=v.tenant_id
                WHERE v.tenant_id=g.tenant_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph->'nodes') n WHERE n->>'personGroupId'=g.id::text)),'[]'::json) AS workflows,
              COALESCE(json_agg(json_build_object('id',u.id,'name',u.name,'email',u.email,'active',u.active,'capabilities',u.capabilities) ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL),'[]'::json) AS members
       FROM public.person_groups g LEFT JOIN public.departments d ON d.id=g.department_id AND d.tenant_id=g.tenant_id
       LEFT JOIN public.person_group_members m ON m.person_group_id=g.id AND m.tenant_id=g.tenant_id
       LEFT JOIN public.users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
       WHERE g.tenant_id=$1 GROUP BY g.id,d.name ORDER BY lower(g.name),g.id`,
      [req.user!.tenantId],
    )
    res.json({ data: result.rows })
  } catch (error) { next(error) }
})

router.get('/reviewers', async (req: AuthRequest, res, next) => {
  try {
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : ''
    if (departmentId && !UUID_RE.test(departmentId)) { res.status(400).json({ error: 'Choose a valid department.' }); return }
    const result = await query(
      `SELECT u.id,u.name,u.email,u.staff_id,u.role,u.primary_department_id,
              ARRAY(SELECT m.department_id FROM public.department_memberships m WHERE m.tenant_id=u.tenant_id AND m.user_id=u.id) AS department_ids
       FROM public.users u WHERE u.tenant_id=$1 AND u.active=true
         AND ('form_approver'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities))
         AND ($2::uuid IS NULL OR u.primary_department_id=$2::uuid OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.tenant_id=u.tenant_id AND m.user_id=u.id AND m.department_id=$2::uuid))
       ORDER BY lower(u.name),u.id`,
      [req.user!.tenantId, departmentId || null],
    )
    res.json({ data: result.rows })
  } catch (error) { next(error) }
})

router.post('/person-groups', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : ''
    const memberIds = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds)] : []
    if (req.body.active !== undefined && typeof req.body.active !== 'boolean') { res.status(400).json({error:'Choose a valid group status.'}); return }
    const departmentId = req.body.departmentId || null
    if (departmentId && !UUID_RE.test(departmentId)) { res.status(400).json({ error: 'Choose a valid department.' }); return }
    if (!name || name.length > 120 || description.length > 2000 || memberIds.length > 100 || memberIds.some((id: unknown) => typeof id !== 'string' || !UUID_RE.test(id))) {
      res.status(400).json({ error: 'Enter a group name, a description up to 2,000 characters, and up to 100 valid members.' }); return
    }
    await beginActorTransaction(client)
    if (departmentId && !await ensureDepartment(departmentId, req.user!.tenantId,client.query.bind(client))) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Choose an active department in this workspace.' }); return }
    const group = await client.query(
      'INSERT INTO public.person_groups(tenant_id,name,description,created_by,department_id,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,description,active,department_id,created_at',
      [req.user!.tenantId, name, description, req.user!.id, departmentId, req.body.active ?? true],
    )
    if (memberIds.length) {
      const inserted = await client.query(
        `INSERT INTO public.person_group_members(tenant_id,person_group_id,user_id) SELECT $1,$2,u.id FROM public.users u WHERE u.tenant_id=$1 AND u.id=ANY($3::uuid[])
         AND ($4::uuid IS NULL OR u.primary_department_id=$4 OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=$1 AND dm.user_id=u.id AND dm.department_id=$4)) RETURNING user_id`,
        [req.user!.tenantId, group.rows[0].id, memberIds, departmentId],
      )
      if (inserted.rowCount !== memberIds.length) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Every group member must be an account in this tenant.' }); return }
    }
    await client.query('COMMIT')
    await auditLog({ tenantId: req.user!.tenantId, userId: req.user!.id, action: 'person_group.created', entityType: 'person_groups', entityId: group.rows[0].id, detail: { memberCount: memberIds.length } })
    res.status(201).json({ data: { ...group.rows[0], members: memberIds } })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) } finally { client.release() }
})

router.put('/person-groups/:groupId', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : ''
    const memberIds = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds)] : null
    const departmentId = req.body.departmentId === undefined ? undefined : req.body.departmentId || null
    if (departmentId && !UUID_RE.test(departmentId)) { res.status(400).json({ error: 'Choose a valid department.' }); return }
    if (req.body.active !== undefined && typeof req.body.active !== 'boolean') { res.status(400).json({ error: 'Choose a valid group status.' }); return }
    if (!UUID_RE.test(req.params.groupId) || !name || name.length > 120 || description.length > 2000 || !memberIds || memberIds.length > 100 || memberIds.some((id: unknown) => typeof id !== 'string' || !UUID_RE.test(id))) {
      res.status(400).json({ error: 'Enter a group name, a description up to 2,000 characters, and up to 100 valid members.' }); return
    }
    await beginActorTransaction(client)
    if (departmentId && !await ensureDepartment(departmentId, req.user!.tenantId,client.query.bind(client))) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Choose an active department in this workspace.' }); return }
    const updated = await client.query('UPDATE public.person_groups SET name=$1,description=$2,active=COALESCE($5,active),department_id=CASE WHEN $6 THEN $7::uuid ELSE department_id END,updated_at=now() WHERE id=$3 AND tenant_id=$4 RETURNING id,department_id', [name, description, req.params.groupId, req.user!.tenantId, req.body.active ?? null, departmentId !== undefined, departmentId ?? null])
    if (!updated.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Person Group not found.' }); return }
    const eligible = await client.query(`SELECT u.id FROM public.users u WHERE u.tenant_id=$1 AND u.id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR u.primary_department_id=$3 OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=$1 AND dm.user_id=u.id AND dm.department_id=$3))`,[req.user!.tenantId,memberIds,updated.rows[0].department_id])
    if (eligible.rowCount !== memberIds.length) { await client.query('ROLLBACK'); res.status(400).json({ error:'Every member must belong to this workspace and the selected group department.' }); return }
    await client.query('DELETE FROM public.person_group_members WHERE tenant_id=$1 AND person_group_id=$2 AND NOT(user_id=ANY($3::uuid[]))', [req.user!.tenantId, req.params.groupId, memberIds])
    if (memberIds.length) {
      await client.query(`INSERT INTO public.person_group_members(tenant_id,person_group_id,user_id) SELECT $1,$2,u.id FROM public.users u WHERE u.tenant_id=$1 AND u.id=ANY($3::uuid[]) ON CONFLICT(person_group_id,user_id) DO NOTHING`, [req.user!.tenantId, req.params.groupId, memberIds])
    }
    await client.query('COMMIT')
    await auditLog({ tenantId: req.user!.tenantId, userId: req.user!.id, action: 'person_group.updated', entityType: 'person_groups', entityId: req.params.groupId, detail: { memberCount: memberIds.length } })
    res.json({ data: { success: true } })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) } finally { client.release() }
})

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT w.id AS workflow_id,w.workflow_code,v.id AS version_id,v.version_number,v.name,v.description,
              v.applicability_department_id,v.is_default,v.status,v.graph,v.created_at,v.updated_at,d.name AS department_name
       FROM public.approval_workflows w JOIN public.approval_workflow_versions v ON v.workflow_id=w.id AND v.tenant_id=w.tenant_id
       LEFT JOIN public.departments d ON d.id=v.applicability_department_id AND d.tenant_id=v.tenant_id
       WHERE w.tenant_id=$1 ORDER BY lower(w.workflow_code),v.version_number DESC`,
      [req.user!.tenantId],
    )
    res.json({ data: result.rows })
  } catch (error) { next(error) }
})

router.get('/default', requireCapability('form_author'), async (req: AuthRequest, res, next) => {
  try {
    const departmentId = String(req.query.departmentId || req.user!.primaryDepartmentId)
    if (!UUID_RE.test(departmentId)) { res.status(400).json({ error: 'Choose a valid department.' }); return }
    const accessible = await query(
      `SELECT 1 FROM public.departments d WHERE d.id=$1 AND d.tenant_id=$2 AND d.active=true
       AND (d.id=$3 OR inspectai_private.department_access($2,d.id))`,
      [departmentId, req.user!.tenantId, req.user!.primaryDepartmentId],
    )
    if (!accessible.rowCount) { res.status(404).json({ error: 'Department not found.' }); return }
    const result = await query(
      `SELECT v.*,w.workflow_code FROM public.approval_workflow_versions v JOIN public.approval_workflows w ON w.id=v.workflow_id AND w.tenant_id=v.tenant_id
       WHERE v.tenant_id=$1 AND v.status='active' AND v.is_default
         AND (v.applicability_department_id=$2 OR v.applicability_department_id IS NULL)
       ORDER BY (v.applicability_department_id IS NOT NULL) DESC LIMIT 1 FOR SHARE OF v`,
      [req.user!.tenantId, departmentId],
    )
    if (!result.rowCount) { res.json({ data: null }); return }
    const evaluated = await routeIssues(result.rows[0], req.user!.tenantId)
    res.json({ data: { ...result.rows[0], issues: evaluated.issues, stages: evaluated.route.map((node) => node.type === 'start' || node.type === 'publish' ? { nodeId: node.id, type: node.type, stageName: node.label || (node.type === 'start' ? 'Start' : 'Publish') } : evaluated.stageDetails.find((stage) => stage.nodeId === node.id) || { nodeId: node.id, type: node.type, stageName: node.label, assignment: 'Unconfigured' }) } })
  } catch (error) { next(error) }
})

function validateMetadata(body: any): { ok: boolean; error?: string; departmentId: string | null } {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const code = typeof body.workflowCode === 'string' ? body.workflowCode.trim().toUpperCase() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const departmentId = body.departmentId == null || body.departmentId === '' ? null : String(body.departmentId)
  if (!name || name.length > 160) return { ok: false, error: 'Workflow name must be 1 to 160 characters.', departmentId }
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return { ok: false, error: 'Use 2 to 40 letters, numbers, dashes or underscores for the workflow code.', departmentId }
  if (description.length > 4000) return { ok: false, error: 'Description must be 4,000 characters or fewer.', departmentId }
  if (departmentId && !DEPARTMENT_RE.test(departmentId)) return { ok: false, error: 'Choose a valid applicability department.', departmentId }
  if (typeof body.isDefault !== 'boolean') return { ok: false, error: 'Choose whether this workflow is the default for its applicability.', departmentId }
  return { ok: true, departmentId }
}

async function ensureDepartment(departmentId: string | null, tenantId: string, run: typeof query | any = query) {
  if (!departmentId) return true
  const result = await run('SELECT 1 FROM public.departments WHERE id=$1 AND tenant_id=$2 AND active=true', [departmentId, tenantId])
  return result.rowCount > 0
}

router.post('/', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const meta = validateMetadata(req.body)
    const { graph, error } = graphInput(req.body.graph ?? { nodes: [], edges: [] })
    if (!meta.ok || error) { res.status(400).json({ error: meta.error || error }); return }
    const workflowCode = String(req.body.workflowCode).trim().toUpperCase()
    await beginActorTransaction(client)
    if (!(await ensureDepartment(meta.departmentId, req.user!.tenantId, client.query.bind(client)))) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Applicability must use an active department in this tenant.' }); return }
    const workflowId = randomUUID(), versionId = randomUUID()
    await client.query('INSERT INTO public.approval_workflows(id,tenant_id,workflow_code,created_by) VALUES($1,$2,$3,$4)', [workflowId, req.user!.tenantId, workflowCode, req.user!.id])
    const saved = await client.query(
      `INSERT INTO public.approval_workflow_versions(id,tenant_id,workflow_id,version_number,name,description,applicability_department_id,is_default,graph,created_by)
       VALUES($1,$2,$3,1,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
      [versionId, req.user!.tenantId, workflowId, String(req.body.name).trim(), String(req.body.description || '').trim(), meta.departmentId, req.body.isDefault, JSON.stringify(graph), req.user!.id],
    )
    await client.query('COMMIT')
    res.status(201).json({ data: { workflowId, workflowCode, ...saved.rows[0] } })
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error?.code === '23505') { res.status(409).json({ error: 'A workflow with this code already exists in this workspace.' }); return }
    next(error)
  } finally { client.release() }
})

router.post('/:workflowId/draft', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    if (!UUID_RE.test(req.params.workflowId)) { res.status(404).json({ error: 'Workflow not found.' }); return }
    await beginActorTransaction(client)
    const workflow = await client.query('SELECT * FROM public.approval_workflows WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.workflowId, req.user!.tenantId])
    if (!workflow.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Workflow not found.' }); return }
    const draft = await client.query('SELECT * FROM public.approval_workflow_versions WHERE workflow_id=$1 AND tenant_id=$2 AND status=$3 FOR UPDATE', [req.params.workflowId, req.user!.tenantId, 'draft'])
    if (draft.rowCount) { await client.query('COMMIT'); res.json({ data: draft.rows[0] }); return }
    const source = await client.query('SELECT * FROM public.approval_workflow_versions WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY version_number DESC LIMIT 1 FOR UPDATE', [req.params.workflowId, req.user!.tenantId])
    if (!source.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Workflow version not found.' }); return }
    const old = source.rows[0]
    const created = await client.query(
      `INSERT INTO public.approval_workflow_versions(tenant_id,workflow_id,version_number,name,description,applicability_department_id,is_default,graph,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'draft',$9) RETURNING *`,
      [req.user!.tenantId, req.params.workflowId, old.version_number + 1, old.name, old.description, old.applicability_department_id, old.is_default, JSON.stringify(old.graph), req.user!.id],
    )
    await client.query('COMMIT')
    res.status(201).json({ data: created.rows[0] })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) } finally { client.release() }
})

router.put('/:workflowId/versions/:versionId', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    if (!UUID_RE.test(req.params.workflowId) || !UUID_RE.test(req.params.versionId)) { res.status(404).json({ error: 'Workflow draft not found.' }); return }
    const meta = validateMetadata(req.body)
    const parsed = graphInput(req.body.graph)
    if (!meta.ok || parsed.error) { res.status(400).json({ error: meta.error || parsed.error }); return }
    const code = String(req.body.workflowCode).trim().toUpperCase()
    await beginActorTransaction(client)
    const version = await client.query('SELECT * FROM public.approval_workflow_versions WHERE id=$1 AND workflow_id=$2 AND tenant_id=$3 FOR UPDATE', [req.params.versionId, req.params.workflowId, req.user!.tenantId])
    if (!version.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Workflow draft not found.' }); return }
    if (version.rows[0].status !== 'draft') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Active workflow versions are immutable. Create a draft version to edit.' }); return }
    if (!(await ensureDepartment(meta.departmentId, req.user!.tenantId, client.query.bind(client)))) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Applicability must use an active department in this tenant.' }); return }
    const workflow = await client.query('SELECT workflow_code FROM public.approval_workflows WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.workflowId, req.user!.tenantId])
    if (!workflow.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Workflow not found.' }); return }
    if (workflow.rows[0].workflow_code !== code) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Workflow code is fixed after creation so historical approval records keep their original reference.' }); return }
    const saved = await client.query(
      `UPDATE public.approval_workflow_versions SET name=$1,description=$2,applicability_department_id=$3,is_default=$4,graph=$5::jsonb,updated_at=now()
       WHERE id=$6 AND workflow_id=$7 AND tenant_id=$8 AND status='draft' RETURNING *`,
      [String(req.body.name).trim(), String(req.body.description || '').trim(), meta.departmentId, req.body.isDefault, JSON.stringify(parsed.graph), req.params.versionId, req.params.workflowId, req.user!.tenantId],
    )
    await client.query('COMMIT')
    res.json({ data: { workflowCode: code, ...saved.rows[0] } })
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error?.code === '23505') { res.status(409).json({ error: 'A workflow with this code already exists in this workspace.' }); return }
    next(error)
  } finally { client.release() }
})

async function routeIssues(version: any, tenantId: string, run: typeof query | any = query) {
  const validated = validateWorkflowGraph(version.graph)
  const issues: WorkflowIssue[] = [...validated.issues]
  const departmentRes = await run('SELECT id FROM public.departments WHERE tenant_id=$1 AND active=true AND ($2::uuid IS NULL OR id=$2::uuid) ORDER BY id', [tenantId, version.applicability_department_id || null])
  const departments: string[] = departmentRes.rows.map((row: any) => row.id)
  if (version.applicability_department_id && !departments.length)
    issues.push({ message: 'Choose an active applicability department in this workspace.' })
  const stageDetails: Array<Record<string, unknown>> = []
  for (const node of validated.route.filter((item) => item.type === 'individual' || item.type === 'group')) {
    const eligibleForDepartment = async (departmentId: string) => {
      if (node.type === 'individual') {
        if (!node.reviewerId || !UUID_RE.test(node.reviewerId)) return []
        const result = await run(
          `SELECT u.id,u.name FROM public.users u WHERE u.id=$1 AND u.tenant_id=$2 AND u.active=true
           AND ('form_approver'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities))
           AND (u.primary_department_id=$3 OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.tenant_id=$2 AND m.user_id=u.id AND m.department_id=$3))`,
          [node.reviewerId, tenantId, departmentId],
        )
        return result.rows
      }
      if (!node.personGroupId || !UUID_RE.test(node.personGroupId)) return []
      const result = await run(
        `SELECT u.id,u.name FROM public.person_groups g JOIN public.person_group_members m ON m.tenant_id=g.tenant_id AND m.person_group_id=g.id
         JOIN public.users u ON u.tenant_id=m.tenant_id AND u.id=m.user_id
         WHERE g.id=$1 AND g.tenant_id=$2 AND g.active=true AND u.active=true AND (g.department_id IS NULL OR g.department_id=$3)
         AND ('form_approver'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities))
         AND (u.primary_department_id=$3 OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=$2 AND dm.user_id=u.id AND dm.department_id=$3)) ORDER BY u.name,u.id`,
        [node.personGroupId, tenantId, departmentId],
      )
      return result.rows
    }
    const candidates = new Map<string, any>()
    for (const departmentId of departments) {
      const members = await eligibleForDepartment(departmentId)
      if (!members.length && !version.applicability_department_id) issues.push({nodeId:node.id,message:`This stage has no eligible reviewer in department ${departmentId}. Restrict the workflow applicability or assign reviewers for every department.`})
      for (const member of members) candidates.set(member.id,member)
    }
    if (node.type === 'individual' && !node.reviewerId) issues.push({ nodeId: node.id, message: 'Select a named reviewer for this approval stage.' })
    else if (node.type === 'group' && !node.personGroupId) issues.push({ nodeId: node.id, message: 'Select a reusable Person Group for this stage.' })
    else if (!candidates.size) issues.push({ nodeId: node.id, message: node.type === 'group' ? 'This group has no active eligible reviewer in the workflow applicability. Add an active form approver with department access.' : 'This reviewer is inactive, lacks approval permission, or is outside the workflow applicability. Choose an eligible reviewer.' })
    else if (node.type === 'individual') stageDetails.push({ nodeId: node.id, type: node.type, stageName: node.label, reviewerId: [...candidates.values()][0].id, reviewerName: [...candidates.values()][0].name })
    else stageDetails.push({ nodeId: node.id, type: node.type, stageName: node.label, personGroupId: node.personGroupId, groupRule: node.groupRule, eligibleMembers: [...candidates.values()].map((member) => ({ id: member.id, name: member.name })) })
  }
  return { issues, route: validated.route, stageDetails }
}

router.post('/:workflowId/versions/:versionId/preview', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      'SELECT v.*,w.workflow_code FROM public.approval_workflow_versions v JOIN public.approval_workflows w ON w.id=v.workflow_id AND w.tenant_id=v.tenant_id WHERE v.id=$1 AND v.workflow_id=$2 AND v.tenant_id=$3',
      [req.params.versionId, req.params.workflowId, req.user!.tenantId],
    )
    if (!result.rowCount) { res.status(404).json({ error: 'Workflow version not found.' }); return }
    const evaluated = await routeIssues(result.rows[0], req.user!.tenantId)
    res.json({ data: { issues: evaluated.issues, stages: evaluated.route.map((node) => {
      if (node.type === 'start') return { nodeId: node.id, type: node.type, stageName: node.label || 'Start' }
      if (node.type === 'publish') return { nodeId: node.id, type: node.type, stageName: node.label || 'Publish' }
      return evaluated.stageDetails.find((stage) => stage.nodeId === node.id) || { nodeId: node.id, type: node.type, stageName: node.label, assignment: 'Unconfigured' }
    }) } })
  } catch (error) { next(error) }
})

router.post('/:workflowId/versions/:versionId/activate', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    if (!UUID_RE.test(req.params.workflowId) || !UUID_RE.test(req.params.versionId)) { res.status(404).json({ error: 'Workflow draft not found.' }); return }
    await beginActorTransaction(client)
    const versionRes = await client.query(
      'SELECT v.*,w.workflow_code FROM public.approval_workflow_versions v JOIN public.approval_workflows w ON w.id=v.workflow_id AND w.tenant_id=v.tenant_id WHERE v.id=$1 AND v.workflow_id=$2 AND v.tenant_id=$3 FOR UPDATE OF v,w',
      [req.params.versionId, req.params.workflowId, req.user!.tenantId],
    )
    if (!versionRes.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Workflow draft not found.' }); return }
    const version = versionRes.rows[0]
    if (version.status !== 'draft') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Create a draft version before activating workflow changes.' }); return }
    const evaluation = await routeIssues(version, req.user!.tenantId, client.query.bind(client))
    if (evaluation.issues.length) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Fix the highlighted workflow issues before activation.', issues: evaluation.issues }); return }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${req.user!.tenantId}:approval-workflow:${version.applicability_department_id || 'all'}`])
    if (version.is_default) {
      const conflicting = await client.query(
        `SELECT v.name FROM public.approval_workflow_versions v WHERE v.tenant_id=$1 AND v.status='active' AND v.is_default
         AND v.workflow_id<>$2 AND v.applicability_department_id IS NOT DISTINCT FROM $3::uuid LIMIT 1`,
        [req.user!.tenantId, version.workflow_id, version.applicability_department_id],
      )
      if (conflicting.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: `Another active default workflow already applies to this scope: ${conflicting.rows[0].name}. Clear its default or change this scope.` }); return }
    }
    await client.query("UPDATE public.approval_workflow_versions SET status='retired',updated_at=now() WHERE tenant_id=$1 AND workflow_id=$2 AND status='active'", [req.user!.tenantId, version.workflow_id])
    const activated = await client.query("UPDATE public.approval_workflow_versions SET status='active',updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *", [version.id, req.user!.tenantId])
    await client.query('COMMIT')
    await auditLog({ tenantId: req.user!.tenantId, userId: req.user!.id, action: 'approval_workflow.activated', entityType: 'approval_workflow_versions', entityId: version.id, detail: { workflowCode: version.workflow_code, versionNumber: version.version_number, nodeCount: evaluation.route.length } })
    res.json({ data: activated.rows[0] })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) } finally { client.release() }
})

export default router
