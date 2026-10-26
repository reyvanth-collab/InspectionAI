import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { useDepartments } from '@/hooks/useDepartments'
import { useAssets, useCreateAsset, useUpdateAsset, type AssetInput } from '@/hooks/useAssets'
import type { Asset } from '@/types'
const blank: AssetInput = {
  assetNumber: '',
  name: '',
  category: '',
  location: '',
  status: 'active',
  criticality: 'medium',
  manufacturer: '',
  model: '',
  serialNumber: '',
  notes: '',
}
export default function Assets() {
  const { user } = useAuth(),
    { data: departments = [] } = useDepartments(),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState(''),
    [error, setError] = useState(''),
    [form, setForm] = useState<AssetInput>(blank)
  const { data, isLoading, error: loadError } = useAssets({ search, status, page }),
    create = useCreateAsset(),
    update = useUpdateAsset(),
    manage = can(user, 'asset_manager')
  function edit(a: Asset) {
    setEditing(a.id)
    setForm({ ...a, departmentId: a.departmentId })
    setError('')
    setShow(true)
  }
  async function save() {
    setError('')
    try {
      if (editing) await update.mutateAsync({ id: editing, ...form })
      else
        await create.mutateAsync({
          ...form,
          departmentId: form.departmentId || user?.primaryDepartmentId,
        })
      setShow(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Asset could not be saved')
    }
  }
  return (
    <AppLayout breadcrumb={[{ label: 'Assets' }]}>
      <div className="flex flex-wrap justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Assets</h1>
          <p className="text-sm text-text-2 mt-2">
            The asset register used for inspection work orders.
          </p>
        </div>
        {manage && (
          <Button
            variant="primary"
            onClick={() => {
              setForm(blank)
              setEditing('')
              setError('')
              setShow(true)
            }}
          >
            Create asset
          </Button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          aria-label="Search assets"
          className="field-input"
          placeholder="Search asset number, name or location"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <select
          aria-label="Asset status"
          className="field-input sm:max-w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          {['all', 'active', 'maintenance', 'retired'].map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <p>Loading assets…</p>}
      {loadError && (
        <p className="text-danger" role="alert">
          Assets could not be loaded. Please try again.
        </p>
      )}
      {data?.items.length === 0 && (
        <div className="execution-card text-center text-text-2">No assets match these filters.</div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data?.items.map((a) => (
          <article className="execution-card" key={a.id}>
            <div className="flex justify-between text-xs">
              <span className="font-mono text-accent">{a.assetNumber}</span>
              <span>{a.status}</span>
            </div>
            <h2 className="font-semibold mt-3">{a.name}</h2>
            <p className="text-sm text-text-2 mt-2">{a.location || 'Location not recorded'}</p>
            <p className="text-xs text-text-2 mt-2">
              {departments.find((d) => d.id === a.departmentId)?.name || 'Department'} ·{' '}
              {a.category || 'Uncategorised'} · {a.criticality} criticality
            </p>
            <p className="text-xs text-text-2 mt-3">
              {a.openWorkOrders} open work orders · {a.completedInspections} completed inspections
            </p>
            {manage && (
              <Button variant="secondary" className="mt-4" onClick={() => edit(a)}>
                Edit asset
              </Button>
            )}
          </article>
        ))}
      </div>
      <div className="flex justify-between items-center mt-5">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-sm text-text-2">Page {page}</span>
        <Button variant="secondary" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
      <Modal
        open={show}
        onClose={() => setShow(false)}
        title={editing ? 'Edit asset' : 'Create asset'}
        footer={
          <Button
            variant="primary"
            loading={create.isPending || update.isPending}
            disabled={!form.name || !form.assetNumber}
            onClick={() => void save()}
          >
            Save asset
          </Button>
        }
      >
        <div className="grid sm:grid-cols-2 gap-4">
          {(
            [
              ['assetNumber', 'Asset number'],
              ['name', 'Asset name'],
              ['location', 'Location / site code and name'],
              ['category', 'Category'],
              ['manufacturer', 'Manufacturer'],
              ['model', 'Model'],
              ['serialNumber', 'Serial number'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field-label">
              {label}
              <input
                aria-label={label}
                className="field-input mt-2"
                readOnly={editing !== '' && key === 'assetNumber'}
                value={form[key] || ''}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="field-label">
            Department
            <select
              aria-label="Asset department"
              disabled={!!editing}
              className="field-input mt-2"
              value={form.departmentId || user?.primaryDepartmentId || ''}
              onChange={(e) => setForm((p) => ({ ...p, departmentId: e.target.value }))}
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Status
            <select
              className="field-input mt-2"
              value={form.status}
              onChange={(e) =>
                setForm((p) => ({ ...p, status: e.target.value as AssetInput['status'] }))
              }
            >
              {['active', 'maintenance', 'retired'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Criticality
            <select
              className="field-input mt-2"
              value={form.criticality}
              onChange={(e) =>
                setForm((p) => ({ ...p, criticality: e.target.value as AssetInput['criticality'] }))
              }
            >
              {['low', 'medium', 'high', 'critical'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field-label sm:col-span-2">
            Supporting notes
            <textarea
              className="field-input mt-2"
              value={form.notes || ''}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </label>
          {error && (
            <p role="alert" className="text-danger text-sm sm:col-span-2">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </AppLayout>
  )
}
