import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { History } from '@/components/ui/History'
import { useDepartments } from '@/hooks/useDepartments'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
interface Profile {
  id: string
  name: string
  email: string
  primary_department_id: string
  department_ids: string[]
  capabilities: string[]
}
const capabilities = [
  ['inspector', 'Inspector'],
  ['form_author', 'Form author'],
  ['form_approver', 'Form approver'],
  ['viewer', 'Viewer'],
  ['asset_manager', 'Manage assets'],
  ['work_order_manager', 'Manage work orders'],
  ['administrator', 'Administrator'],
]
export default function Settings() {
  const { user } = useAuth(),
    [params, setParams] = useSearchParams(),
    qc = useQueryClient(),
    { data: departments = [] } = useDepartments(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [code, setCode] = useState(''),
    [name, setName] = useState(''),
    [selected, setSelected] = useState<Profile | null>(null),
    [reason, setReason] = useState('')
  const admin = can(user, 'administrator'),
    tab = params.get('tab') || (admin ? 'departments' : 'profile')
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    enabled: admin,
    queryFn: async () => (await api.get<{ data: Profile[] }>('/users')).data.data,
  })
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      setMessage(success)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['departments'] }),
        qc.invalidateQueries({ queryKey: ['admin-users'] }),
        qc.invalidateQueries({ queryKey: ['history'] }),
      ])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save the change')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AppLayout breadcrumb={[{ label: 'Settings' }]}>
      <h1 className="text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-sm text-text-2 mb-6">Account details and authorised administration.</p>
      <div className="flex flex-wrap gap-2 mb-5">
        {[...(admin ? ['departments', 'users', 'history'] : []), 'profile', 'password'].map((t) => (
          <button
            key={t}
            className={`px-4 py-2 text-sm rounded-lg border ${tab === t ? 'border-accent text-accent bg-accent-bg' : 'border-border'}`}
            onClick={() => {
              setParams({ tab: t })
              setMessage('')
            }}
          >
            {t === 'users'
              ? 'People & access'
              : t === 'history'
                ? 'Activity history'
                : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="text-sm p-3 bg-bg-2 border border-border rounded-lg mb-4">
          {message}
        </p>
      )}
      {admin && tab === 'history' && <History />}
      {admin && tab === 'departments' && (
        <div className="space-y-5">
          <div className="execution-card">
            <h2 className="font-semibold mb-4">Create department</h2>
            <div className="grid sm:grid-cols-[160px_1fr_auto] gap-3">
              <input
                aria-label="Department code"
                className="field-input"
                placeholder="Code, e.g. SIG"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <input
                aria-label="Department name"
                className="field-input"
                placeholder="Department name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="primary"
                loading={busy}
                disabled={!code || !name}
                onClick={() =>
                  void run(async () => {
                    await api.post('/departments', { code, name })
                    setCode('')
                    setName('')
                  }, 'Department created')
                }
              >
                Create department
              </Button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {departments.map((d) => (
              <div className="execution-card" key={d.id}>
                <span className="text-xs font-mono text-accent">{d.code}</span>
                <h3 className="font-medium mt-2">{d.name}</h3>
              </div>
            ))}
          </div>
        </div>
      )}
      {admin && tab === 'users' && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-5">
          <div className="space-y-2">
            {users.map((u) => (
              <button
                key={u.id}
                className="execution-card block w-full text-left text-sm"
                onClick={() => {
                  setSelected({
                    ...u,
                    department_ids: u.department_ids || [u.primary_department_id],
                  })
                  setReason('')
                }}
              >
                <strong>{u.name}</strong>
                <span className="block text-xs text-text-2 mt-1">{u.email}</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="execution-card">
              <h2 className="font-semibold mb-4">Access for {selected.name}</h2>
              <p className="text-sm text-text-2 mb-4">
                Authors and approvers are separate capabilities. Department memberships also control
                cross-department review access. Administrators have tenant-wide oversight.
              </p>
              <label className="field-label">
                Primary department
                <select
                  aria-label="Primary department"
                  className="field-input mt-2"
                  value={selected.primary_department_id}
                  onChange={(e) =>
                    setSelected({
                      ...selected,
                      primary_department_id: e.target.value,
                      department_ids: [...new Set([...selected.department_ids, e.target.value])],
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
              <fieldset className="mt-4">
                <legend className="text-sm font-semibold mb-3">
                  Additional department memberships
                </legend>
                {departments.map((d) => (
                  <label key={d.id} className="flex gap-2 items-center py-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={d.id === selected.primary_department_id}
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
              <fieldset className="mt-4">
                <legend className="text-sm font-semibold mb-3">Capabilities</legend>
                <div className="grid sm:grid-cols-2 gap-3">
                  {capabilities.map(([c, label]) => (
                    <label key={c} className="flex gap-2 items-center text-sm">
                      <input
                        type="checkbox"
                        checked={selected.capabilities.includes(c)}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            capabilities: e.target.checked
                              ? [...selected.capabilities, c]
                              : selected.capabilities.filter((v) => v !== c),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field-label mt-5">
                Reason for access change
                <textarea
                  aria-label="Access change reason"
                  className="field-input mt-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                variant="primary"
                className="mt-4"
                loading={busy}
                disabled={selected.id === user?.id || !reason.trim()}
                onClick={() =>
                  void run(
                    () =>
                      api.put(`/departments/users/${selected.id}`, {
                        primaryDepartmentId: selected.primary_department_id,
                        departmentIds: selected.department_ids,
                        capabilities: selected.capabilities,
                        reason,
                      }),
                    'Access updated',
                  )
                }
              >
                Save access
              </Button>
              {selected.id === user?.id && (
                <p className="text-sm text-text-2 mt-3">
                  Another administrator must change your own access.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {tab === 'profile' && (
        <div className="execution-card">
          <h2 className="font-semibold">{user?.name}</h2>
          <p className="text-sm text-text-2 mt-2">
            {user?.email} · {user?.staffId}
          </p>
          <p className="text-sm mt-4">
            Department:{' '}
            {departments.find((d) => d.id === user?.primaryDepartmentId)?.name || 'Not recorded'}
          </p>
        </div>
      )}
      {tab === 'password' && (
        <div className="execution-card">
          <h2 className="font-semibold">Reset your password</h2>
          <p className="text-sm text-text-2 mt-2 mb-4">
            Send a secure reset link to your account email. Changing your password invalidates
            existing application sessions.
          </p>
          <Button
            variant="primary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await supabase.auth.resetPasswordForEmail(user!.email, {
                  redirectTo: window.location.origin + '/reset-password',
                })
                if (error) throw error
              }, 'If the account is available, a reset email will arrive shortly.')
            }
          >
            Send password reset email
          </Button>
        </div>
      )}
      {!admin && !['profile', 'password'].includes(tab) && <p>Administrator access is required.</p>}
    </AppLayout>
  )
}
