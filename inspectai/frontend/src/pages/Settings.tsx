import { UsersAccess } from '@/components/UsersAccess'
import { ValidationSummary } from '@/components/ui/ValidationSummary'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { History } from '@/components/ui/History'
import { useDepartments } from '@/hooks/useDepartments'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
export default function Settings() {
  const { user } = useAuth(),
    [params, setParams] = useSearchParams(),
    qc = useQueryClient(),
    { data: departments = [] } = useDepartments(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [code, setCode] = useState(''),
    [name, setName] = useState('')
  const [departmentAttempt, setDepartmentAttempt] = useState(0)
  const departmentIssues = departmentAttempt
    ? [
        ...(!/^[A-Z0-9_-]{2,32}$/.test(code)
          ? [
              {
                id: 'department-code',
                message: 'Enter a department code of 2–32 letters, digits, - or _',
              },
            ]
          : []),
        ...(!name.trim() ? [{ id: 'department-name', message: 'Enter a department name' }] : []),
      ]
    : []
  const admin = can(user, 'administrator'),
    tab = params.get('tab') || (admin ? 'departments' : 'profile')
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
            <ValidationSummary issues={departmentIssues} attempt={departmentAttempt} />
            <div className="grid sm:grid-cols-[160px_1fr_auto] gap-3">
              <input
                id="department-code"
                aria-label="Department code"
                className="field-input"
                placeholder="Code, e.g. SIG"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <input
                id="department-name"
                aria-label="Department name"
                className="field-input"
                placeholder="Department name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="primary"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    setDepartmentAttempt((x) => x + 1)
                    if (!/^[A-Z0-9_-]{2,32}$/.test(code) || !name.trim())
                      throw new Error('Correct the department fields before creating it')
                    await api.post('/departments', { code, name })
                    setDepartmentAttempt(0)
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
      {admin && tab === 'users' && <UsersAccess />}
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
