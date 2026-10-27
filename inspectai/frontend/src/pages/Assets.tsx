import { RecordTable } from '@/components/ui/RecordTable'
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
    [detail, setDetail] = useState<Asset | null>(null),
    [sort, setSort] = useState('number'),
    [direction, setDirection] = useState('asc'),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState(''),
    [error, setError] = useState(''),
    [form, setForm] = useState<AssetInput>(blank)
  const {
      data,
      isLoading,
      error: loadError,
      refetch,
    } = useAssets({ search, status, page, sort, direction }),
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
          Assets could not be loaded. <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      {data?.items.length === 0 && (
        <div className="execution-card text-center text-text-2">No assets match these filters.</div>
      )}
      <RecordTable
        label="Assets"
        rows={data?.items || []}
        rowKey={(a) => a.assetNumber}
        sort={sort}
        direction={direction}
        onSort={(key) => {
          setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc')
          setSort(key)
          setPage(1)
        }}
        columns={[
          {
            key: 'number',
            label: 'Asset number',
            essential: true,
            render: (a) => (
              <button className="font-mono text-accent text-left" onClick={() => setDetail(a)}>
                {a.assetNumber}
              </button>
            ),
          },
          { key: 'description', label: 'Description', essential: true, render: (a) => a.name },
          {
            key: 'department',
            label: 'Department',
            render: (a) => departments.find((d) => d.id === a.departmentId)?.name || 'Not recorded',
          },
          { key: 'location', label: 'Location', render: (a) => a.location || 'Not recorded' },
          { key: 'category', label: 'Category', render: (a) => a.category || 'Not recorded' },
          { key: 'status', label: 'Status', render: (a) => a.status },
        ]}
      />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.assetNumber || 'Asset'}>
        <dl>
          {detail &&
            Object.entries({
              Description: detail.name,
              Location: detail.location,
              Department: departments.find((d) => d.id === detail.departmentId)?.name,
              Category: detail.category,
              Status: detail.status,
              Notes: detail.notes,
            }).map(([key, value]) => (
              <div key={key} className="mb-3">
                <dt className="text-xs text-text-2">{key}</dt>
                <dd className="break-words">{value || 'Not recorded'}</dd>
              </div>
            ))}
        </dl>
        {detail && manage && (
          <Button
            onClick={() => {
              edit(detail)
              setDetail(null)
            }}
          >
            Edit asset
          </Button>
        )}
      </Modal>
      <div className="flex justify-between items-center mt-5">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-sm text-text-2">
          Page {page} ? {data?.total || 0} matching assets
        </span>
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
