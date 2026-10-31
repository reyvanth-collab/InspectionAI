import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { useDepartments } from '@/hooks/useDepartments'
import { api } from '@/lib/api'
import { RecordTable } from './ui/RecordTable'
import { RecordPageSummary } from './ui/RecordPageSummary'
import { Button } from './ui/Button'
import { ValidationSummary } from './ui/ValidationSummary'
interface Profile {
  id: string
  name: string
  email: string
  staff_id: string
  active: boolean
  primary_department_id: string
  department_ids: string[]
  capabilities: string[]
}
const capabilityOptions = [
  ['inspector', 'Inspector'],
  ['form_author', 'Form author'],
  ['form_approver', 'Form approver'],
  ['viewer', 'Viewer'],
  ['asset_manager', 'Manage assets'],
  ['work_order_manager', 'Manage work orders'],
  ['administrator', 'Administrator'],
]
export function UsersAccess() {
  const { user } = useAuth(),
    { data: departments = [] } = useDepartments(),
    qc = useQueryClient()
  const [search, setSearch] = useState(''),
    [department, setDepartment] = useState(''),
    [capability, setCapability] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [sort, setSort] = useState('name'),
    [direction, setDirection] = useState('asc')
  const [selected, setSelected] = useState<Profile | null>(null),
    [reason, setReason] = useState(''),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const params = new URLSearchParams({
    search,
    departmentId: department,
    capability,
    status,
    page: String(page),
    pageSize: '25',
    sort,
    direction,
  })
  const query = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: async () =>
      (
        await api.get<{
          data: Profile[]
          meta: { total: number; pageSize: number; page: number; hasMore: boolean }
        }>('/users?' + params)
      ).data,
  })
  const issues =
    selected && attempt
      ? [
          ...(!selected.primary_department_id
            ? [{ id: 'access-primary', message: 'Choose a primary department' }]
            : []),
          ...(!selected.capabilities.length
            ? [{ id: 'access-capabilities', message: 'Select at least one capability' }]
            : []),
          ...(!reason.trim()
            ? [{ id: 'access-reason', message: 'Explain why this access is changing' }]
            : []),
        ]
      : []
  async function save() {
    setAttempt((x) => x + 1)
    if (
      !selected ||
      !reason.trim() ||
      !selected.capabilities.length ||
      !selected.primary_department_id
    )
      return
    setBusy(true)
    setMessage('')
    try {
      await api.put('/departments/users/' + selected.id, {
        primaryDepartmentId: selected.primary_department_id,
        departmentIds: selected.department_ids,
        capabilities: selected.capabilities,
        reason,
      })
      setMessage('Access updated')
      setSelected(null)
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Access could not be saved')
    } finally {
      setBusy(false)
    }
  }
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name || 'Not recorded'
  const filter = (set: (s: string) => void, value: string) => {
    set(value)
    setPage(1)
  }
  return (
    <section aria-label="Users and access">
      <h2 className="text-lg font-semibold mb-4">Users &amp; Access</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <input
          aria-label="Search users"
          className="field-input"
          placeholder="Name, email or staff ID"
          value={search}
          onChange={(e) => filter(setSearch, e.target.value)}
        />
        <select
          aria-label="User department"
          className="field-input"
          value={department}
          onChange={(e) => filter(setDepartment, e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="User capability"
          className="field-input"
          value={capability}
          onChange={(e) => filter(setCapability, e.target.value)}
        >
          <option value="">All capabilities</option>
          {capabilityOptions.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Account status"
          className="field-input"
          value={status}
          onChange={(e) => filter(setStatus, e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      {query.isLoading && <p role="status">Loading users…</p>}
      {query.error && (
        <div role="alert">
          Users could not be loaded.{' '}
          <button onClick={() => void query.refetch()}>Retry users</button>
        </div>
      )}
      {!query.isLoading && !query.error && query.data?.data.length === 0 && (
        <p className="execution-card">No users match these filters.</p>
      )}
      <RecordTable
        label="Users and access"
        rows={query.data?.data || []}
        rowKey={(u) => u.id}
        sort={sort}
        direction={direction}
        onSort={(key) => {
          setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc')
          setSort(key)
          setPage(1)
        }}
        columns={[
          { key: 'name', label: 'Name', essential: true, render: (u) => u.name },
          {
            key: 'email',
            label: 'Email / staff ID',
            essential: true,
            render: (u) => (
              <>
                <span className="block">{u.email}</span>
                <span className="text-xs">{u.staff_id}</span>
              </>
            ),
          },
          {
            key: 'department',
            label: 'Primary department',
            render: (u) => deptName(u.primary_department_id),
          },
          {
            key: 'memberships',
            label: 'Additional access',
            sort: false,
            render: (u) =>
              u.department_ids
                .filter((id) => id !== u.primary_department_id)
                .map(deptName)
                .join(', ') || 'None',
          },
          {
            key: 'capabilities',
            label: 'Capabilities',
            sort: false,
            render: (u) =>
              u.capabilities
                .map((c) => capabilityOptions.find(([id]) => id === c)?.[1] || c)
                .join(', '),
          },
          {
            key: 'status',
            label: 'Account status',
            render: (u) => (u.active ? 'Active' : 'Inactive'),
          },
          {
            key: 'action',
            label: 'Manage access',
            essential: true,
            sort: false,
            render: (u) =>
              u.id === user?.id ? (
                <span className="text-xs">Another administrator must edit your access</span>
              ) : (
                <button
                  className="text-accent"
                  aria-label={'Manage access for ' + u.name}
                  onClick={() => {
                    setSelected({
                      ...u,
                      department_ids: [...u.department_ids],
                      capabilities: [...u.capabilities],
                    })
                    setReason('')
                    setAttempt(0)
                    setMessage('')
                    requestAnimationFrame(() =>
                      document.getElementById('access-editor')?.scrollIntoView({ block: 'start' }),
                    )
                  }}
                >
                  Manage access
                </button>
              ),
          },
        ]}
      />
      <div className="flex items-center justify-between gap-2 mt-4">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <RecordPageSummary
          page={query.data?.meta.page || page}
          pageSize={25}
          count={query.data?.data.length || 0}
          total={query.data?.meta.total || 0}
          label="users"
        />
        <Button
          variant="secondary"
          disabled={!query.data?.meta.hasMore}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
      {message && (
        <p role="alert" className="execution-card mt-4">
          {message}
        </p>
      )}
      {selected && (
        <section id="access-editor" className="execution-card mt-6">
          <h3 className="font-semibold mb-4">Access for {selected.name}</h3>
          <ValidationSummary issues={issues} attempt={attempt} />
          <label className="field-label">
            Primary department
            <select
              id="access-primary"
              className="field-input mt-2"
              value={selected.primary_department_id}
              onChange={(e) =>
                setSelected({
                  ...selected,
                  primary_department_id: e.target.value,
                  department_ids: [
                    ...selected.department_ids.filter(
                      (id) => id !== selected.primary_department_id,
                    ),
                    e.target.value,
                  ],
                })
              }
            >
              {departments.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-text-2 mt-2">
            Changing primary department removes the previous primary membership. Select it
            explicitly below if continued access is intended.
          </p>
          <fieldset className="mt-4">
            <legend>Additional department access</legend>
            {departments
              .filter((d) => d.id !== selected.primary_department_id)
              .map((d) => (
                <label className="flex gap-2 py-2" key={d.id}>
                  <input
                    type="checkbox"
                    checked={selected.department_ids.includes(d.id)}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        department_ids: e.target.checked
                          ? [...selected.department_ids, d.id]
                          : selected.department_ids.filter((id) => id !== d.id),
                      })
                    }
                  />
                  {d.name}
                </label>
              ))}
          </fieldset>
          <fieldset id="access-capabilities" className="mt-4">
            <legend>Capabilities</legend>
            {capabilityOptions.map(([id, label]) => (
              <label className="inline-flex gap-2 mr-4 py-2" key={id}>
                <input
                  type="checkbox"
                  checked={selected.capabilities.includes(id)}
                  onChange={(e) =>
                    setSelected({
                      ...selected,
                      capabilities: e.target.checked
                        ? [...selected.capabilities, id]
                        : selected.capabilities.filter((c) => c !== id),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field-label mt-4">
            Reason for access change
            <textarea
              id="access-reason"
              className="field-input mt-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-3 mt-4">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save access
            </Button>
          </div>
        </section>
      )}
    </section>
  )
}
