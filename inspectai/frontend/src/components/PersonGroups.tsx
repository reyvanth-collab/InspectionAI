import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDepartments } from '@/hooks/useDepartments'
import { Modal } from '@/components/ui/Modal'

type Member = { id: string; name: string; email: string; active?: boolean; primary_department_id?: string; department_ids?: string[] }
type Group = { id: string; name: string; description: string; active: boolean; department_id: string | null; department_name?: string; active_member_count: number; members: Member[]; workflows: Array<{ workflowId: string; code: string; name: string; version: number; status: string }> }
const explain = (error: unknown) => error instanceof Error ? error.message : 'The Person Group could not be saved.'

export function PersonGroups() {
  const { data: departments = [] } = useDepartments()
  const [groups, setGroups] = useState<Group[]>([]), [candidates, setCandidates] = useState<Member[]>([])
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [departmentId, setDepartmentId] = useState('')
  const [active, setActive] = useState(true), [members, setMembers] = useState<string[]>([]), [memberSearch, setMemberSearch] = useState('')
  async function load() {
    const [list, users] = await Promise.all([api.get<{ data: Group[] }>('/approval-workflows/person-groups'), api.get<{ data: Member[] }>('/approval-workflows/reviewers')])
    setGroups(list.data.data); setCandidates(users.data.data)
  }
  useEffect(() => { void load().catch((cause) => setError(explain(cause))) }, [])
  function edit(group: Group | null) {
    setEditing(group); setName(group?.name || ''); setDescription(group?.description || '')
    setDepartmentId(group?.department_id || ''); setActive(group?.active ?? true)
    setMembers(group?.members.map((member) => member.id) || []); setMemberSearch(''); setError(''); setOpen(true)
  }
  async function save() {
    setBusy(true); setError('')
    try {
      const body = { name, description, departmentId: departmentId || null, active, memberIds: members }
      if (editing) await api.put('/approval-workflows/person-groups/' + editing.id, body)
      else await api.post('/approval-workflows/person-groups', body)
      await load(); setOpen(false)
    } catch (cause) { setError(explain(cause)) } finally { setBusy(false) }
  }
  const allMembers = [...new Map([...candidates, ...(editing?.members || [])].map((member) => [member.id, member])).values()]
  const visible = groups.filter((group) => (status === 'all' || (status === 'active') === group.active) && `${group.name} ${group.description} ${group.department_name || ''} ${group.workflows.map((item) => item.code).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  return <section aria-label="Person Groups" className="space-y-4">
    <div className="flex justify-between gap-3 items-start"><div><h2 className="text-xl font-semibold">Person Groups</h2><p className="mt-1 text-sm text-text-2">Reusable reviewer candidates. Permission, department access and independent review are checked again when routing and deciding.</p></div><button className="wf-button wf-primary" onClick={() => edit(null)}>Create Person Group</button></div>
    {error && !open && <p role="alert" className="text-danger">{error}</p>}
    <div className="flex flex-wrap gap-3"><label className="wf-field flex-1">Search Person Groups<input className="field-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, department or workflow code"/></label><label className="wf-field">Group status<select className="field-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
    <p className="text-sm text-text-2" role="status">{visible.length} matching groups</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-border">{['Person Group','Department','Status','Active members','Workflow references',''].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{visible.map((group) => <tr key={group.id} className="border-b border-border"><td className="p-3"><strong>{group.name}</strong><p className="text-xs text-text-2">{group.description}</p></td><td className="p-3">{group.department_name || 'All departments'}</td><td className="p-3">{group.active ? 'Active' : 'Inactive'}</td><td className="p-3">{group.active_member_count} of {group.members.length}</td><td className="p-3">{group.workflows.length ? group.workflows.map((item) => <Link key={`${item.workflowId}-${item.version}`} to="/approval-workflows" className="block text-accent">{item.code} v{item.version} · {item.status}</Link>) : 'No workflow references'}</td><td className="p-3"><button className="wf-button" aria-label={`Manage ${group.name}`} onClick={() => edit(group)}>Manage</button></td></tr>)}</tbody></table>{!visible.length && <p className="p-5 text-text-2">No matching Person Groups.</p>}</div>
    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Manage Person Group' : 'Create Person Group'} footer={<><button className="wf-button" onClick={() => setOpen(false)}>Cancel</button><button className="wf-button wf-primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save group</button></>}>
      <div className="space-y-4">{error && <p role="alert" className="text-danger">{error}</p>}
        <label className="wf-field">Group name<input className="field-input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)}/></label>
        <label className="wf-field">Group description<textarea className="field-input" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)}/></label>
        <label className="wf-field">Group department<select className="field-input" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">All departments in this workspace</option>{departments.filter((department) => department.active || department.id === departmentId).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/>Group active</label>
        <p className="text-xs text-text-2">Deactivation prevents future routing. Existing runs keep their saved assignments. Remove members outside a newly selected department before saving.</p>
        <label className="wf-field">Search members<input className="field-input" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)}/></label>
        <div className="max-h-64 overflow-y-auto border border-border rounded-lg">{allMembers.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(memberSearch.toLowerCase())).map((member) => <label key={member.id} className="flex gap-3 p-3 text-sm border-b border-border"><input type="checkbox" checked={members.includes(member.id)} onChange={() => setMembers((old) => old.includes(member.id) ? old.filter((id) => id !== member.id) : [...old,member.id])}/><span>{member.name}{member.active === false ? ' (inactive)' : ''}<small className="block text-text-2">{member.email}</small></span></label>)}</div>
      </div>
    </Modal>
  </section>
}
