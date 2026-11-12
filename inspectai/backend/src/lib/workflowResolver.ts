import { validateWorkflowGraph, type WorkflowNode } from './approvalWorkflow'

type QueryFn = (text: string, params?: unknown[]) => Promise<any>

export interface ResolvedApprovalStep {
  stepNumber: number
  nodeId: string
  label: string
  approverId: string
  groupRule: 'any' | 'all'
  stageSize: number
}

export interface ResolvedWorkflow {
  workflowVersionId: string
  routeSnapshot: Record<string, unknown>
  steps: ResolvedApprovalStep[]
  issues: Array<{ nodeId?: string; message: string }>
}

export async function resolveDefaultWorkflow(
  run: QueryFn,
  input: { tenantId: string; departmentId: string; formId: string; submitterId: string; ownerId: string },
): Promise<ResolvedWorkflow | null> {
  const found = await run(
    `SELECT v.id,v.version_number,v.name,v.applicability_department_id,w.workflow_code,v.graph
     FROM public.approval_workflow_versions v JOIN public.approval_workflows w ON w.id=v.workflow_id AND w.tenant_id=v.tenant_id
     WHERE v.tenant_id=$1 AND v.status='active' AND v.is_default
       AND (v.applicability_department_id=$2 OR v.applicability_department_id IS NULL)
     ORDER BY (v.applicability_department_id IS NOT NULL) DESC,v.version_number DESC LIMIT 1 FOR SHARE OF v`,
    [input.tenantId, input.departmentId],
  )
  if (!found.rowCount) return null
  const version = found.rows[0]
  const { graph, route, issues } = validateWorkflowGraph(version.graph)
  if (issues.length) return { workflowVersionId: version.id, routeSnapshot: {}, steps: [], issues }
  const resolved: ResolvedApprovalStep[] = []
  const stages: Array<Record<string, unknown>> = []
  for (const node of route.filter((item: WorkflowNode) => item.type === 'individual' || item.type === 'group')) {
    let members: Array<{ id: string; name: string }> = []
    let stageLabel = String(node.label || '').trim()
    if (node.type === 'individual') {
      if (!node.reviewerId) {
        issues.push({ nodeId: node.id, message: 'Select a named reviewer for this stage.' })
        continue
      }
      const result = await run(
        `SELECT u.id,u.name FROM public.users u
         WHERE u.id=$1 AND u.tenant_id=$2 AND u.active=true
           AND ('form_approver'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities))
           AND (u.primary_department_id=$3 OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=$2 AND dm.user_id=u.id AND dm.department_id=$3))
           AND u.id<>$4 AND u.id<>$5 AND NOT inspectai_private.form_contributor($6::uuid,u.id) FOR SHARE OF u`,
        [node.reviewerId, input.tenantId, input.departmentId, input.submitterId, input.ownerId, input.formId],
      )
      members = result.rows
      if (!members.length) issues.push({ nodeId: node.id, message: 'The named reviewer is inactive, lacks approval permission, is outside this department, or contributed to this revision.' })
    } else {
      if (!node.personGroupId) {
        issues.push({ nodeId: node.id, message: 'Select a reusable Person Group for this stage.' })
        continue
      }
      const result = await run(
        `SELECT u.id,u.name,g.name AS group_name FROM public.person_groups g
         JOIN public.person_group_members m ON m.tenant_id=g.tenant_id AND m.person_group_id=g.id
         JOIN public.users u ON u.tenant_id=m.tenant_id AND u.id=m.user_id
         WHERE g.id=$1 AND g.tenant_id=$2 AND g.active=true AND u.active=true AND (g.department_id IS NULL OR g.department_id=$3)
           AND ('form_approver'=ANY(u.capabilities) OR 'administrator'=ANY(u.capabilities))
           AND (u.primary_department_id=$3 OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=$2 AND dm.user_id=u.id AND dm.department_id=$3))
           AND u.id<>$4 AND u.id<>$5 AND NOT inspectai_private.form_contributor($6::uuid,u.id)
         ORDER BY u.id FOR SHARE OF g,u,m`,
        [node.personGroupId, input.tenantId, input.departmentId, input.submitterId, input.ownerId, input.formId],
      )
      members = result.rows.map((row: any) => ({ id: row.id, name: row.name }))
      const groupName = result.rows[0]?.group_name || 'Person Group'
      stageLabel = stageLabel === groupName ? stageLabel : `${stageLabel} · ${groupName}`
      if (!members.length) issues.push({ nodeId: node.id, message: 'This Person Group has no eligible independent reviewer for this form department. Add an active approver with department membership.' })
    }
    if (!members.length) continue
    const groupRule: 'any' | 'all' = node.type === 'group' ? node.groupRule || 'any' : 'all'
    const stepNumber = resolved.filter((step) => step.nodeId !== node.id).reduce((max, step) => Math.max(max, step.stepNumber), 0) + 1
    for (const member of members)
      resolved.push({ stepNumber, nodeId: node.id, label: stageLabel, approverId: member.id, groupRule, stageSize: members.length })
    stages.push({ nodeId: node.id, type: node.type, label: stageLabel, groupRule, members })
  }
  const previewRoute = route.map((node: WorkflowNode) => {
    if (node.type === 'start' || node.type === 'publish')
      return { nodeId: node.id, type: node.type, stageName: node.label || (node.type === 'start' ? 'Start' : 'Publish') }
    return stages.find((stage) => stage.nodeId === node.id) || { nodeId: node.id, type: node.type, stageName: node.label, assignment: 'Unconfigured' }
  })
  return {
    workflowVersionId: version.id,
    steps: resolved,
    issues,
    routeSnapshot: {
      workflowVersionId: version.id,
      workflowCode: version.workflow_code,
      name: version.name,
      versionNumber: version.version_number,
      applicabilityDepartmentId: version.applicability_department_id,
      graph,
      stages,
      route: previewRoute,
    },
  }
}
