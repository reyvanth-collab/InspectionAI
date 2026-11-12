import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { useDepartments } from '@/hooks/useDepartments'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { api, ApiError } from '@/lib/api'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CirclePlus, CornerDownRight, Eye, UsersRound, Minus, Plus, Save, Trash2, UserRound, Workflow, ZoomIn, ZoomOut, LocateFixed } from 'lucide-react'

type NodeType = 'start' | 'individual' | 'group' | 'publish'
type WorkflowNode = { id: string; type: NodeType; label: string; x: number; y: number; reviewerId?: string | null; personGroupId?: string | null; groupRule?: 'any' | 'all' }
type WorkflowGraph = { nodes: WorkflowNode[]; edges: Array<{ id: string; source: string; target: string }> }
type WorkflowVersion = { id?: string; workflow_id: string; workflow_code: string; version_id: string; version_number: number; name: string; description: string; applicability_department_id: string | null; is_default: boolean; status: 'draft' | 'active' | 'retired'; graph: WorkflowGraph }
type Reviewer = { id: string; name: string; email: string; role: string }
type PersonGroup = { id: string; name: string; description: string; active: boolean; members: Array<{ id: string; name: string; email: string; active: boolean; capabilities: string[] }> }
type Issue = { nodeId?: string; edgeId?: string; message: string }
type RoutePreview = { nodeId: string; type: NodeType; stageName?: string; label?: string; reviewerName?: string; groupRule?: 'any' | 'all'; eligibleMembers?: Array<{ id: string; name: string }>; assignment?: string }

const initialGraph = (): WorkflowGraph => ({ nodes: [], edges: [] })
const titles: Record<NodeType, string> = { start: 'Start', individual: 'Individual Approval', group: 'Group Approval', publish: 'Publish' }
const edgePath = (source: WorkflowNode, target: WorkflowNode) => {
  const sx = source.x + 210, sy = source.y + 64, tx = target.x, ty = target.y + 64
  const curve = Math.max(45, Math.abs(tx - sx) * 0.45)
  return { d: `M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`, x: (sx + tx) / 2, y: (sy + ty) / 2 }
}
const messageOf = (error: unknown) => {
  const e = error as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error || e?.message || 'The request could not be completed.'
}

export default function ApprovalWorkflows() {
  const { user } = useAuth()
  const { data: departments = [] } = useDepartments()
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [groups, setGroups] = useState<PersonGroup[]>([])
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [personCandidates, setPersonCandidates] = useState<Reviewer[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [workflowId, setWorkflowId] = useState('')
  const [workflowCode, setWorkflowCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [graph, setGraph] = useState<WorkflowGraph>(initialGraph)
  const [baseline, setBaseline] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [connectFrom, setConnectFrom] = useState('')
  const [connectionPointer, setConnectionPointer] = useState<{x:number;y:number} | null>(null)
  const connectionStart = useRef<{source:string;clientX:number;clientY:number;moved:boolean} | null>(null)
  const [zoom, setZoom] = useState(0.9)
  const [pan, setPan] = useState({ x: 24, y: 22 })
  const [issues, setIssues] = useState<Issue[]>([])
  const [routePreview, setRoutePreview] = useState<RoutePreview[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [showNewWorkflow, setShowNewWorkflow] = useState(false)
  const [showGroupEditor, setShowGroupEditor] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([])
  const [newWorkflow, setNewWorkflow] = useState({ code: '', name: '', description: '', departmentId: '', isDefault: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const dragNode = useRef<{ id: string; clientX: number; clientY: number; x: number; y: number } | null>(null)
  const panDrag = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null)
  const current = versions.find((version) => version.version_id === selectedVersionId)
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId)
  const active = current?.status !== 'draft'
  const dirty = !!current && JSON.stringify({ name, description, departmentId: departmentId || null, isDefault, graph }) !== baseline
  const nodeIssues = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const issue of issues) if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) || []), issue])
    return map
  }, [issues])

  async function loadLists() {
    const [workflowResult, groupResult, reviewerResult] = await Promise.all([
      api.get<{ data: WorkflowVersion[] }>('/approval-workflows'),
      api.get<{ data: PersonGroup[] }>('/approval-workflows/person-groups'),
      api.get<{ data: Reviewer[] }>('/approval-workflows/reviewers'),
    ])
    const nextVersions = workflowResult.data.data.map((row) => ({ ...row, graph: row.graph || initialGraph() }))
    setVersions(nextVersions)
    setGroups(groupResult.data.data)
    setReviewers(reviewerResult.data.data)
    setPersonCandidates(reviewerResult.data.data)
    return nextVersions
  }

  function openVersion(version: WorkflowVersion) {
    const nextGraph = JSON.parse(JSON.stringify(version.graph || initialGraph())) as WorkflowGraph
    setSelectedVersionId(version.version_id)
    setWorkflowId(version.workflow_id)
    setWorkflowCode(version.workflow_code)
    setName(version.name)
    setDescription(version.description || '')
    setDepartmentId(version.applicability_department_id || '')
    setIsDefault(!!version.is_default)
    setGraph(nextGraph)
    setIssues([])
    setRoutePreview([])
    setSelectedNodeId('')
    setConnectFrom('')
    setBaseline(JSON.stringify({ name: version.name, description: version.description || '', departmentId: version.applicability_department_id || null, isDefault: !!version.is_default, graph: nextGraph }))
  }

  useEffect(() => {
    if (!can(user, 'administrator')) return
    loadLists().then((rows) => {
      if (rows.length) {
        const preferred = rows.find((row) => row.status === 'draft') || rows.find((row) => row.status === 'active') || rows[0]
        openVersion(preferred)
      }
    }).catch((cause) => setError(messageOf(cause)))
  }, [user?.id])

  useEffect(() => {
    if (!departmentId) return
    api.get<{ data: Reviewer[] }>('/approval-workflows/reviewers?departmentId=' + encodeURIComponent(departmentId))
      .then((result) => setReviewers(result.data.data)).catch((cause) => setError(messageOf(cause)))
  }, [departmentId])

  function applyGraph(next: WorkflowGraph) {
    setGraph(next)
    setIssues([])
    setRoutePreview([])
  }

  function addNode(type: NodeType, x?: number, y?: number) {
    const id = crypto.randomUUID()
    const index = graph.nodes.length
    const node: WorkflowNode = { id, type, label: titles[type], x: x ?? 80 + (index % 3) * 280, y: y ?? 100 + Math.floor(index / 3) * 220, groupRule: 'any', reviewerId: null, personGroupId: null }
    applyGraph({ ...graph, nodes: [...graph.nodes, node] })
    setSelectedNodeId(id)
  }

  function dropNode(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/inspectai-node') as NodeType
    if (!type || !(type in titles) || !viewport.current) return
    const rect = viewport.current.getBoundingClientRect()
    addNode(type, Math.max(12, (event.clientX - rect.left - pan.x) / zoom), Math.max(12, (event.clientY - rect.top - pan.y) / zoom))
  }

  function moveNode(event: PointerEvent<HTMLElement>, node: WorkflowNode) {
    if (event.button !== 0) return
    event.stopPropagation()
    dragNode.current = { id: node.id, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (connectionStart.current && viewport.current) {
      const start = connectionStart.current, rect = viewport.current.getBoundingClientRect()
      start.moved ||= Math.hypot(event.clientX-start.clientX,event.clientY-start.clientY)>4
      setConnectionPointer({x:(event.clientX-rect.left-pan.x)/zoom,y:(event.clientY-rect.top-pan.y)/zoom})
    } else if (dragNode.current) {
      const start = dragNode.current
      const dx = (event.clientX - start.clientX) / zoom
      const dy = (event.clientY - start.clientY) / zoom
      setGraph((old) => ({ ...old, nodes: old.nodes.map((node) => node.id === start.id ? { ...node, x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy) } : node) }))
    } else if (panDrag.current) {
      const start = panDrag.current
      setPan({ x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY })
    }
  }

  function pointerUp() { dragNode.current = null; panDrag.current = null; connectionStart.current = null; setConnectionPointer(null) }

  function startConnection(event: PointerEvent<HTMLButtonElement>, node: WorkflowNode) {
    event.stopPropagation(); event.preventDefault()
    if (active || event.button !== 0) return
    connectionStart.current = {source:node.id,clientX:event.clientX,clientY:event.clientY,moved:false}
    setConnectFrom(node.id); setSelectedNodeId(node.id); setError('')
  }

  function finishConnection(event: PointerEvent<HTMLButtonElement>, target: WorkflowNode) {
    if (!connectionStart.current?.moved) return
    event.stopPropagation(); event.preventDefault()
    connectTarget(target)
    connectionStart.current = null; setConnectionPointer(null)
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('.wf-node,.wf-edge-remove'))) return
    panDrag.current = { clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function connectTarget(target: WorkflowNode) {
    if (!connectFrom) return
    if (connectFrom === target.id) { setError('A node cannot connect to itself.'); return }
    const id = crypto.randomUUID()
    applyGraph({ ...graph, edges: [...graph.edges, { id, source: connectFrom, target: target.id }] })
    setConnectFrom('')
    setError('')
  }

  function updateNode(id: string, patch: Partial<WorkflowNode>) {
    applyGraph({ ...graph, nodes: graph.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) })
  }

  function removeNode(id: string) {
    applyGraph({ nodes: graph.nodes.filter((node) => node.id !== id), edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id) })
    if (selectedNodeId === id) setSelectedNodeId('')
    if (connectFrom === id) setConnectFrom('')
  }

  function nudge(id: string, dx: number, dy: number) {
    const node = graph.nodes.find((item) => item.id === id)
    if (node) updateNode(id, { x: Math.max(0, node.x + dx), y: Math.max(0, node.y + dy) })
  }

  function fitGraph() {
    if (!viewport.current || !graph.nodes.length) { setPan({ x: 24, y: 22 }); setZoom(0.9); return }
    viewport.current.scrollLeft=0; viewport.current.scrollTop=0
    const width = viewport.current.clientWidth - 60, height = viewport.current.clientHeight - 60
    const left = Math.min(...graph.nodes.map((node) => node.x)), top = Math.min(...graph.nodes.map((node) => node.y))
    const right = Math.max(...graph.nodes.map((node) => node.x + 210)), bottom = Math.max(...graph.nodes.map((node) => node.y + 130))
    const scale = Math.min(1.2, Math.max(0.35, Math.min(width / (right - left), height / (bottom - top))))
    setZoom(scale)
    setPan({ x: 30 - left * scale, y: 30 - top * scale })
  }

  async function saveDraft(): Promise<WorkflowVersion | null> {
    if (!current || active) return null
    setBusy(true); setError('')
    try {
      const result = await api.put<{ data: WorkflowVersion & { workflowCode: string } }>(`/approval-workflows/${workflowId}/versions/${selectedVersionId}`, {
        workflowCode, name, description, departmentId: departmentId || null, isDefault, graph,
      })
      const updated = { ...result.data.data, workflow_code: result.data.data.workflowCode || workflowCode, workflow_id: workflowId, version_id: selectedVersionId, graph } as WorkflowVersion
      setVersions((rows) => rows.map((row) => row.version_id === selectedVersionId ? updated : row))
      setBaseline(JSON.stringify({ name, description, departmentId: departmentId || null, isDefault, graph }))
      return updated
    } catch (cause) { setError(messageOf(cause)); return null } finally { setBusy(false) }
  }

  async function saveAndPreview() {
    let target = current
    if (!target) return
    if (dirty) { target = await saveDraft() || undefined as unknown as WorkflowVersion; if (!target) return }
    setBusy(true); setError('')
    try {
      const result = await api.post<{ data: { issues: Issue[]; stages: RoutePreview[] } }>(`/approval-workflows/${workflowId}/versions/${selectedVersionId}/preview`)
      setIssues(result.data.data.issues)
      setRoutePreview(result.data.data.stages)
      setShowPreview(true)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function activate() {
    setBusy(true); setError('')
    try {
      const result = await api.post<{ data: WorkflowVersion }>(`/approval-workflows/${workflowId}/versions/${selectedVersionId}/activate`)
      await loadLists()
      const activated = { ...result.data.data, workflow_id: workflowId, workflow_code: workflowCode, version_id: selectedVersionId, graph } as WorkflowVersion
      setVersions((rows) => rows.map((row) => row.workflow_id === workflowId ? { ...row, status: 'retired' as const } : row).map((row) => row.version_id === selectedVersionId ? activated : row))
      openVersion(activated)
      setShowPreview(false)
      setIssues([])
      setError('Workflow version activated. New form submissions will use this route.')
    } catch (cause) {
      const response = (cause as { response?: { data?: { issues?: Issue[] } } })?.response?.data
      setIssues(response?.issues || (cause instanceof ApiError && cause.issues.length ? cause.issues : [{message:messageOf(cause)}]))
      setError(messageOf(cause))
    } finally { setBusy(false) }
  }

  async function newDraft() {
    if (!current) return
    setBusy(true); setError('')
    try {
      const result = await api.post<{ data: WorkflowVersion }>(`/approval-workflows/${current.workflow_id}/draft`)
      const version = { ...result.data.data, workflow_id: current.workflow_id, workflow_code: current.workflow_code, version_id: result.data.data.id || result.data.data.version_id, graph: result.data.data.graph || initialGraph() } as WorkflowVersion
      await loadLists()
      openVersion(version)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  async function createWorkflow() {
    setBusy(true); setError('')
    try {
      const result = await api.post<{ data: WorkflowVersion & { workflowId: string; workflowCode: string } }>('/approval-workflows', { workflowCode: newWorkflow.code, name: newWorkflow.name, description: newWorkflow.description, departmentId: newWorkflow.departmentId || null, isDefault: newWorkflow.isDefault, graph: initialGraph() })
      const version = { ...result.data.data, workflow_id: result.data.data.workflowId, workflow_code: result.data.data.workflowCode, version_id: result.data.data.id || result.data.data.version_id, graph: initialGraph() } as WorkflowVersion
      setShowNewWorkflow(false)
      setNewWorkflow({ code: '', name: '', description: '', departmentId: '', isDefault: false })
      const rows = await loadLists()
      const saved = rows.find((row) => row.version_id === version.version_id) || version
      openVersion(saved)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  function startGroupEditor(group?: PersonGroup) {
    setEditingGroupId(group?.id || '')
    setGroupName(group?.name || '')
    setGroupDescription(group?.description || '')
    setGroupMemberIds(group?.members.map((member) => member.id) || [])
    setShowGroupEditor(true)
  }

  async function savePersonGroup() {
    setBusy(true); setError('')
    try {
      const payload = { name: groupName, description: groupDescription, memberIds: groupMemberIds }
      if (editingGroupId) await api.put(`/approval-workflows/person-groups/${editingGroupId}`, payload)
      else await api.post('/approval-workflows/person-groups', payload)
      const [groupResult, reviewerResult] = await Promise.all([
        api.get<{ data: PersonGroup[] }>('/approval-workflows/person-groups'),
        api.get<{ data: Reviewer[] }>('/approval-workflows/reviewers'),
      ])
      setGroups(groupResult.data.data)
      setPersonCandidates(reviewerResult.data.data)
      setShowGroupEditor(false)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  if (!can(user, 'administrator')) return <AppLayout title="Approval Workflows"><p className="p-8">Administrator access is required.</p></AppLayout>

  const displayReviewer = (node: WorkflowNode) => reviewers.find((reviewer) => reviewer.id === node.reviewerId)?.name || 'Select reviewer'
  const displayGroup = (node: WorkflowNode) => groups.find((group) => group.id === node.personGroupId)?.name || 'Select Person Group'
  const palette: Array<{ type: NodeType; title: string; icon: typeof Workflow }> = [
    { type: 'start', title: 'Start', icon: CirclePlus },
    { type: 'individual', title: 'Individual Approval', icon: UserRound },
    { type: 'group', title: 'Group Approval', icon: UsersRound },
    { type: 'publish', title: 'Publish', icon: Check },
  ]

  return (
    <AppLayout breadcrumb={[{ label: 'Approval Workflows' }]}>
      <div className="max-w-[1800px] mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div><h1 className="text-2xl font-semibold">Approval Workflows</h1><p className="text-sm text-text-2 mt-1">Build, preview and activate sequential routes for future form submissions.</p></div>
          <div className="flex gap-2 flex-wrap">
            <button className="wf-button" onClick={() => void api.get<{data:Reviewer[]}>('/approval-workflows/reviewers').then((result)=>{setPersonCandidates(result.data.data);startGroupEditor()}).catch((cause)=>setError(messageOf(cause)))}><UsersRound size={16}/> Person Groups</button>
            <button className="wf-button wf-primary" onClick={() => setShowNewWorkflow(true)}><CirclePlus size={16}/> New workflow</button>
          </div>
        </div>
        {error && <div role="status" className="rounded-lg border border-border-2 bg-bg-2 px-4 py-3 text-sm flex gap-2 items-start"><AlertTriangle size={17} className="text-amber mt-0.5 shrink-0"/><span>{error}</span><button className="ml-auto underline" onClick={() => setError('')}>Dismiss</button></div>}
        <section className="execution-card grid gap-3 md:grid-cols-[minmax(180px,1fr)_180px_200px_auto] items-end">
          <label className="wf-field">Workflow version<select className="field-input" value={selectedVersionId} onChange={(event) => { const version = versions.find((item) => item.version_id === event.target.value); if (version) openVersion(version) }}><option value="">Select a workflow</option>{versions.map((version) => <option key={version.version_id} value={version.version_id}>{version.workflow_code} · v{version.version_number} · {version.status}</option>)}</select></label>
          <div className="text-sm text-text-2">{current ? <><span className="block font-semibold text-text">{current.status === 'active' ? 'Active version' : current.status === 'draft' ? 'Draft version' : 'Previous version'}</span><span>{current.is_default ? 'Default route' : 'Not default'}</span></> : 'Create a workflow to begin.'}</div>
          <div className="text-sm text-text-2">{dirty ? 'Unsaved changes' : current ? 'All changes saved' : ''}</div>
          <div className="flex gap-2">
            {active && <button className="wf-button" disabled={busy} onClick={() => void newDraft()}>Edit active version</button>}
            {current && !active && <button className="wf-button wf-primary" disabled={busy || !dirty} onClick={() => void saveDraft()}><Save size={15}/> Save draft</button>}
            {current && !active && <button className="wf-button" disabled={busy} onClick={() => void saveAndPreview()}><Eye size={15}/> Preview route</button>}
          </div>
        </section>
        {current && <section className="execution-card grid gap-3 md:grid-cols-[170px_1fr_1fr_200px_auto] items-end">
          <label className="wf-field">Code<input className="field-input font-mono uppercase" value={workflowCode} disabled={!!workflowId} onChange={(event) => setWorkflowCode(event.target.value.toUpperCase())}/></label>
          <label className="wf-field">Workflow name<input className="field-input" value={name} disabled={active} onChange={(event) => setName(event.target.value)}/></label>
          <label className="wf-field">Description<input className="field-input" value={description} disabled={active} onChange={(event) => setDescription(event.target.value)}/></label>
          <label className="wf-field">Applies to<select className="field-input" value={departmentId} disabled={active} onChange={(event) => setDepartmentId(event.target.value)}><option value="">All departments</option>{departments.filter((department) => department.active).map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={isDefault} disabled={active} onChange={(event) => setIsDefault(event.target.checked)}/> Default in scope</label>
        </section>}

        {current && <div className="wf-workspace">
          <aside className="wf-panel wf-palette" aria-label="Workflow node palette">
            <div className="wf-panel-heading"><span>Node palette</span><span className="text-xs text-text-3">Drag or add</span></div>
            {palette.map(({ type, title, icon: Icon }) => <div key={type} draggable={!active} onDragStart={(event) => event.dataTransfer.setData('application/inspectai-node', type)} className="wf-palette-row"><span className="wf-node-icon"><Icon size={17}/></span><span className="min-w-0 flex-1">{title}</span><button aria-label={`Add ${title}`} disabled={active} onClick={() => addNode(type)} className="wf-icon-button"><Plus size={16}/></button></div>)}
            <div className="mt-5 border-t border-border pt-4"><p className="text-xs text-text-2 leading-5">Drag an output handle to an input handle to draw a connection. With the keyboard, choose the output and then the input. Focus a node and use arrow keys to move it, Enter to edit or Delete to remove it.</p><p className="mt-3 text-xs text-text-2 leading-5">One route: Start → one or more approval stages → Publish. Incomplete drafts can be saved.</p></div>
          </aside>

          <section className="wf-canvas-shell" aria-label="Workflow designer">
            <div className="wf-toolbar">
              <span className="mr-auto text-xs text-text-2">{connectFrom ? 'Select an input handle to connect the next stage.' : `${graph.nodes.length} nodes · ${graph.edges.length} connections`}</span>
              <button aria-label="Pan canvas left" title="Pan left" className="wf-icon-button" onClick={() => setPan((value) => ({ ...value, x: value.x + 80 }))}><ArrowLeft size={15}/></button>
              <button aria-label="Pan canvas up" title="Pan up" className="wf-icon-button" onClick={() => setPan((value) => ({ ...value, y: value.y + 80 }))}><ArrowUp size={15}/></button>
              <button aria-label="Pan canvas down" title="Pan down" className="wf-icon-button" onClick={() => setPan((value) => ({ ...value, y: value.y - 80 }))}><ArrowDown size={15}/></button>
              <button aria-label="Pan canvas right" title="Pan right" className="wf-icon-button" onClick={() => setPan((value) => ({ ...value, x: value.x - 80 }))}><ArrowRight size={15}/></button>
              <button aria-label="Zoom out" className="wf-icon-button" onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}><ZoomOut size={15}/></button><span className="wf-zoom-label">{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" className="wf-icon-button" onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}><ZoomIn size={15}/></button>
              <button aria-label="Fit workflow to canvas" className="wf-icon-button" onClick={fitGraph}><LocateFixed size={15}/></button>
            </div>
            <div ref={viewport} className="wf-viewport" onDragOver={(event) => event.preventDefault()} onDrop={dropNode} onPointerDown={beginPan} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
              <div className="wf-stage" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
                <svg className="wf-connectors" width="1800" height="1100" aria-hidden="true">
                  <defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
                  {graph.edges.map((edge) => { const source = graph.nodes.find((node) => node.id === edge.source), target = graph.nodes.find((node) => node.id === edge.target); if (!source || !target) return null; const path = edgePath(source, target); return <path key={edge.id} d={path.d} className="wf-edge" markerEnd="url(#wf-arrow)"/> })}
                  {connectionPointer && connectFrom && (() => { const source=graph.nodes.find((node)=>node.id===connectFrom); return source ? <path d={edgePath(source,{...source,x:connectionPointer.x,y:connectionPointer.y-64}).d} className="wf-edge" strokeDasharray="6 4" markerEnd="url(#wf-arrow)"/> : null })()}
                </svg>
                {graph.nodes.map((node) => {
                  const issueCount = nodeIssues.get(node.id)?.length || 0
                  const reviewer = displayReviewer(node), group = displayGroup(node)
                  return <div key={node.id} tabIndex={0} onKeyDown={(event)=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter'){event.preventDefault();setSelectedNodeId(node.id)}if(!active){const moves:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(moves[event.key]){event.preventDefault();nudge(node.id,...moves[event.key])}if(['Delete','Backspace'].includes(event.key)){event.preventDefault();removeNode(node.id)}}}} className={`wf-node wf-node-${node.type} ${selectedNodeId === node.id ? 'wf-node-selected' : ''} ${issueCount ? 'wf-node-invalid' : ''}`} style={{ left: node.x, top: node.y } as CSSProperties} onClick={() => setSelectedNodeId(node.id)} role="group" aria-label={`${titles[node.type]} node ${node.label}`}>
                    <div className="wf-node-head" onPointerDown={(event) => !active && moveNode(event, node)}><span className="wf-node-icon"><Workflow size={16}/></span><span className="truncate flex-1">{node.label || titles[node.type]}</span>{issueCount > 0 && <span className="wf-issue-count" aria-label={`${issueCount} issues`}>{issueCount}</span>}<button className="wf-icon-button wf-node-delete" aria-label={`Remove ${node.label || titles[node.type]} node`} disabled={active} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeNode(node.id) }}><Trash2 size={14}/></button></div>
                    <div className="wf-node-body">{node.type === 'individual' ? <><span className="text-[10px] uppercase text-text-3">Named reviewer</span><strong className="truncate">{reviewer}</strong></> : node.type === 'group' ? <><span className="text-[10px] uppercase text-text-3">Person Group</span><strong className="truncate">{group}</strong><span className="text-xs text-accent">{node.groupRule === 'all' ? 'All eligible members' : 'Any one eligible member'}</span></> : <><span className="text-xs text-text-2">{node.type === 'start' ? 'Workflow begins' : 'Activate published form'}</span></>}</div>
                    <button className={`wf-handle wf-in ${connectFrom ? 'wf-handle-ready' : ''}`} aria-label={`Connect into ${node.label || titles[node.type]}`} title="Input handle" disabled={active} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event)=>finishConnection(event,node)} onClick={(event) => { event.stopPropagation(); connectTarget(node) }}/>
                    <button className="wf-handle wf-out" aria-label={`Connect from ${node.label || titles[node.type]}`} title="Output handle" disabled={active} onPointerDown={(event) => startConnection(event,node)} onClick={(event) => { event.stopPropagation(); setConnectFrom(node.id); setSelectedNodeId(node.id); setError('') }}/>
                    {selectedNodeId === node.id && !active && <div className="wf-node-nudge" aria-label={`Move ${node.label || titles[node.type]}`}>
                      <button title="Move up" aria-label="Move up" onClick={(event) => { event.stopPropagation(); nudge(node.id,0,-40) }}><ArrowUp size={12}/></button><button title="Move left" aria-label="Move left" onClick={(event) => { event.stopPropagation(); nudge(node.id,-50,0) }}><ArrowLeft size={12}/></button><button title="Move down" aria-label="Move down" onClick={(event) => { event.stopPropagation(); nudge(node.id,0,40) }}><ArrowDown size={12}/></button><button title="Move right" aria-label="Move right" onClick={(event) => { event.stopPropagation(); nudge(node.id,50,0) }}><ArrowRight size={12}/></button>
                    </div>}
                  </div>
                })}
                {graph.edges.map((edge) => { const source=graph.nodes.find((node)=>node.id===edge.source),target=graph.nodes.find((node)=>node.id===edge.target);if(!source||!target)return null;const path=edgePath(source,target);return <button key={`remove-${edge.id}`} className="wf-edge-remove" style={{left:path.x-10,top:path.y-10} as CSSProperties} aria-label={`Remove connection from ${source.label} to ${target.label}`} disabled={active} onClick={()=>applyGraph({...graph,edges:graph.edges.filter((item)=>item.id!==edge.id)})}><Minus size={13}/></button> })}
                {graph.nodes.length === 0 && <div className="wf-empty-hint"><CornerDownRight size={23}/><strong>Drop a node here to start</strong><span>Or use the keyboard-accessible Add buttons in the palette.</span></div>}
              </div>
            </div>
          </section>

          <aside className="wf-panel wf-properties" aria-label="Node properties">
            <div className="wf-panel-heading"><span>{selectedNode ? 'Node properties' : 'Workflow checks'}</span>{selectedNode && <span className="text-xs text-text-3">{titles[selectedNode.type]}</span>}</div>
            {selectedNode ? <div className="space-y-4">
              <label className="wf-field">Stage name<input className="field-input" value={selectedNode.label} disabled={active} maxLength={100} onChange={(event) => updateNode(selectedNode.id,{label:event.target.value})}/></label>
              {selectedNode.type !== 'publish' && <label className="wf-field">Next connected stage<select className="field-input" disabled={active} value={graph.edges.find((edge)=>edge.source===selectedNode.id)?.target || ''} onChange={(event)=>applyGraph({...graph,edges:[...graph.edges.filter((edge)=>edge.source!==selectedNode.id),...(event.target.value?[{id:crypto.randomUUID(),source:selectedNode.id,target:event.target.value}]:[])]})}><option value="">No outgoing connection</option>{graph.nodes.filter((node)=>node.id!==selectedNode.id && node.type!=='start').map((node)=><option key={node.id} value={node.id}>{node.label || titles[node.type]}</option>)}</select></label>}
              {selectedNode.type === 'individual' && <label className="wf-field">Named reviewer<select className="field-input" value={selectedNode.reviewerId || ''} disabled={active} onChange={(event) => updateNode(selectedNode.id,{reviewerId:event.target.value || null})}><option value="">Select an eligible reviewer</option>{reviewers.map((reviewer)=><option key={reviewer.id} value={reviewer.id}>{reviewer.name} · {reviewer.role}</option>)}</select></label>}
              {selectedNode.type === 'group' && <><label className="wf-field">Person Group<select className="field-input" value={selectedNode.personGroupId || ''} disabled={active} onChange={(event) => updateNode(selectedNode.id,{personGroupId:event.target.value || null})}><option value="">Select a Person Group</option>{groups.filter((group)=>group.active).map((group)=><option key={group.id} value={group.id}>{group.name} · {group.members.length} members</option>)}</select></label><label className="wf-field">Approval rule<select className="field-input" value={selectedNode.groupRule || 'any'} disabled={active} onChange={(event)=>updateNode(selectedNode.id,{groupRule:event.target.value as 'any'|'all'})}><option value="any">Any one eligible member</option><option value="all">All eligible members</option></select></label></>}
              {!active && <div className="grid grid-cols-2 gap-2"><button className="wf-button" onClick={()=>nudge(selectedNode.id,0,-48)}><ArrowUp size={14}/> Move up</button><button className="wf-button" onClick={()=>nudge(selectedNode.id,0,48)}><ArrowDown size={14}/> Move down</button><button className="wf-button" onClick={()=>nudge(selectedNode.id,-60,0)}><ArrowLeft size={14}/> Move left</button><button className="wf-button" onClick={()=>nudge(selectedNode.id,60,0)}><ArrowRight size={14}/> Move right</button></div>}
              {nodeIssues.get(selectedNode.id)?.map((issue,index)=><div className="wf-validation" key={index}><AlertTriangle size={15}/>{issue.message}</div>)}
            </div> : <div className="space-y-3 text-sm text-text-2"><p>Select a node to configure its name, reviewer or group rule.</p><p className="font-medium text-text">Required route</p><p>One Start, at least one approval stage and one Publish endpoint. Connect every node in a single sequential route.</p>{issues.length>0&&issues.map((issue,index)=><div key={index} className="wf-validation"><AlertTriangle size={15}/>{issue.message}</div>)}</div>}
            {!active && <button className="wf-button mt-5 w-full" onClick={()=>void saveDraft()} disabled={busy}><Save size={15}/> Save incomplete draft</button>}
            <Link to="/settings?tab=users&section=groups" className="wf-button mt-4">Manage Person Groups</Link>
          </aside>
        </div>}
      </div>

      <Modal open={showNewWorkflow} onClose={()=>setShowNewWorkflow(false)} title="Create approval workflow" footer={<><button className="wf-button" onClick={()=>setShowNewWorkflow(false)}>Cancel</button><button className="wf-button wf-primary" disabled={busy} onClick={()=>void createWorkflow()}><CirclePlus size={15}/> Create draft</button></>}>
        <div className="space-y-3"><label className="wf-field">Workflow code<input className="field-input font-mono uppercase" autoFocus maxLength={40} value={newWorkflow.code} onChange={(event)=>setNewWorkflow({...newWorkflow,code:event.target.value.toUpperCase()})} placeholder="SIGNAL-REVIEW"/></label><label className="wf-field">Workflow name<input className="field-input" maxLength={160} value={newWorkflow.name} onChange={(event)=>setNewWorkflow({...newWorkflow,name:event.target.value})} placeholder="Signalling form review"/></label><label className="wf-field">Description<input className="field-input" value={newWorkflow.description} onChange={(event)=>setNewWorkflow({...newWorkflow,description:event.target.value})}/></label><label className="wf-field">Applies to<select className="field-input" value={newWorkflow.departmentId} onChange={(event)=>setNewWorkflow({...newWorkflow,departmentId:event.target.value})}><option value="">All departments</option>{departments.filter((item)=>item.active).map((item)=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newWorkflow.isDefault} onChange={(event)=>setNewWorkflow({...newWorkflow,isDefault:event.target.checked})}/> Default for this scope</label></div>
      </Modal>

      <Modal open={showGroupEditor} onClose={()=>setShowGroupEditor(false)} title={editingGroupId?'Edit Person Group':'Create Person Group'} footer={<><button className="wf-button" onClick={()=>setShowGroupEditor(false)}>Cancel</button><button className="wf-button wf-primary" disabled={busy||!groupName.trim()} onClick={()=>void savePersonGroup()}><Save size={15}/> Save group</button></>}>
        <div className="space-y-3"><label className="wf-field">Group name<input className="field-input" autoFocus value={groupName} maxLength={120} onChange={(event)=>setGroupName(event.target.value)}/></label><label className="wf-field">Description<textarea className="field-input min-h-20" value={groupDescription} onChange={(event)=>setGroupDescription(event.target.value)}/></label><label className="wf-field">Eligible members <span className="text-xs text-text-3">Members are filtered again against the form department at submission.</span></label><div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">{personCandidates.map((reviewer)=><label key={reviewer.id} className="flex items-center gap-3 px-3 py-2 text-sm"><input type="checkbox" checked={groupMemberIds.includes(reviewer.id)} onChange={()=>setGroupMemberIds((ids)=>ids.includes(reviewer.id)?ids.filter((id)=>id!==reviewer.id):[...ids,reviewer.id])}/><span className="flex-1">{reviewer.name}</span><span className="text-xs text-text-3">{reviewer.role}</span></label>)}{!personCandidates.length&&<p className="p-3 text-sm text-text-2">No active admin or form approver accounts are available.</p>}</div>{groups.length>0&&<label className="wf-field">Load an existing group to edit<select className="field-input" value={editingGroupId} onChange={(event)=>startGroupEditor(groups.find((item)=>item.id===event.target.value))}><option value="">New Person Group</option>{groups.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}</div>
      </Modal>

      <Modal open={showPreview} onClose={()=>setShowPreview(false)} title="Workflow route preview" maxWidth="max-w-[760px]" footer={<><button className="wf-button" onClick={()=>setShowPreview(false)}>Continue editing</button>{current?.status==='draft'&&<button className="wf-button wf-primary" disabled={busy||issues.length>0} onClick={()=>void activate()}><Check size={15}/> Activate version</button>}</>}>
        <div className="space-y-3"><p className="text-sm text-text-2">{name} · {workflowCode} · version {current?.version_number}{departmentId?` · ${departments.find((item)=>item.id===departmentId)?.name||'Department'}`:' · All departments'}</p>{issues.length>0&&<div className="space-y-2"><h3 className="font-semibold text-danger">Fix these items before activation</h3>{issues.map((issue,index)=><div key={index} className="wf-validation"><AlertTriangle size={15}/><span>{issue.nodeId?`${graph.nodes.find((item)=>item.id===issue.nodeId)?.label||'Node'}: `:''}{issue.message}</span></div>)}</div>}{routePreview.length===0?<p className="text-sm text-text-2">Add and connect nodes, then preview the route.</p>:<ol className="wf-preview-list">{routePreview.map((stage,index)=><li key={stage.nodeId} className="wf-preview-item"><span className="wf-step-number">{index+1}</span><div className="min-w-0"><strong>{stage.stageName||stage.label||titles[stage.type]}</strong><p className="text-xs text-text-2">{stage.type==='start'?'Submission begins here':stage.type==='publish'?'The form becomes active after all approvals':stage.type==='individual'?`Reviewer: ${stage.reviewerName||stage.assignment||'Unassigned'}`:stage.type==='group'?`${stage.groupRule==='all'?'All eligible members':'Any one eligible member'} · ${(stage.eligibleMembers||[]).map((member)=>member.name).join(', ')||stage.assignment||'No eligible members'}`:'Unassigned'}</p></div></li>)}</ol>}{issues.length===0&&routePreview.length>0&&<p className="text-sm text-green-600 flex gap-2 items-center"><Check size={16}/> This sequential route is ready to activate.</p>}</div>
      </Modal>
    </AppLayout>
  )
}
