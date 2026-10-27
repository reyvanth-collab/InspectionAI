import { RecordTable } from '@/components/ui/RecordTable'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { useWorkOrders, useCreateWorkOrder } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { useAssets } from '@/hooks/useAssets'
import { useAssignableUsers } from '@/hooks/useUsers'
import { useDepartments } from '@/hooks/useDepartments'
export default function Inspections() {
  const { user } = useAuth(),
    [sort, setSort] = useState('due'),
    [direction, setDirection] = useState('asc'),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [show, setShow] = useState(false),
    [assetSearch, setAssetSearch] = useState(''),
    [error, setError] = useState('')
  const [form, setForm] = useState({
    assetId: '',
    workInstructionId: '',
    assignedTo: '',
    priority: 'medium',
    dueDate: '',
    notes: '',
  })
  const {
      data,
      isLoading,
      error: loadError,
      refetch,
    } = useWorkOrders(status, page, search, { sort, direction }),
    { data: assetPage } = useAssets({ search: assetSearch, page: 1 }),
    { data: forms = [] } = useWorkInstructions(),
    { data: departments = [] } = useDepartments(),
    create = useCreateWorkOrder()
  const asset = assetPage?.items.find((a) => a.id === form.assetId),
    { data: users = [] } = useAssignableUsers(asset?.departmentId)
  const usable = forms.filter(
    (f) =>
      ['active', 'expiring'].includes(f.status) &&
      (f.checkableItemCount || 0) > 0 &&
      (!f.expiryDate || f.expiryDate >= new Date().toISOString().slice(0, 10)) &&
      (!f.effectiveDate || f.effectiveDate.slice(0, 10) <= new Date().toISOString().slice(0, 10)) &&
      f.departmentId === asset?.departmentId,
  )
  async function createOrder() {
    setError('')
    try {
      await create.mutateAsync(form)
      setShow(false)
      setForm({
        assetId: '',
        workInstructionId: '',
        assignedTo: '',
        priority: 'medium',
        dueDate: '',
        notes: '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Work order could not be created')
    }
  }
  return (
    <AppLayout
      breadcrumb={[
        {
          label: can(user, 'inspector') && !can(user, 'viewer') ? 'My inspections' : 'Inspections',
        },
      ]}
    >
      <div className="page-heading flex flex-wrap justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">
            {can(user, 'inspector') && !can(user, 'viewer') ? 'My inspections' : 'Inspections'}
          </h1>
          <p className="text-sm text-text-2 mt-2">
            Assigned asset inspections, from checklist to signed result.
          </p>
        </div>
        {can(user, 'work_order_manager') && (
          <Button
            variant="primary"
            onClick={() => {
              setError('')
              setShow(true)
            }}
          >
            <Plus size={16} />
            Create work order
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-text-2 mb-5">
        {Object.entries(data?.summary || {})
          .filter(([k]) => ['total', 'open', 'in_progress', 'complete'].includes(k))
          .map(([key, count]) => (
            <span key={key}>
              <strong className="text-text">{count}</strong>{' '}
              {key === 'in_progress' ? 'in progress' : key}
            </span>
          ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          className="field-input flex-1"
          aria-label="Search inspections"
          placeholder="Search work order, asset, location or form"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <select
          aria-label="Inspection status"
          className="field-input sm:max-w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          {[
            ['all', 'All statuses'],
            ['open', 'Open'],
            ['in-progress', 'In progress'],
            ['complete', 'Complete'],
            ['cancelled', 'Cancelled'],
          ].map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <p>Loading inspections…</p>}
      {loadError && (
        <p role="alert" className="text-danger">
          Inspections could not be loaded. <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      {data?.items.length === 0 && (
        <div className="execution-card text-center text-text-2 py-10">
          No inspections match these filters.
        </div>
      )}
      <RecordTable
        label="Inspections"
        rows={data?.items || []}
        rowKey={(w) => w.id}
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
            label: 'Work order',
            essential: true,
            render: (w) => (
              <Link to={'/inspections/' + w.dbId} className="font-mono">
                {w.id}
              </Link>
            ),
          },
          {
            key: 'asset',
            label: 'Asset',
            essential: true,
            render: (w) => (
              <>
                {w.assetNumber && <span className="block text-xs font-mono">{w.assetNumber}</span>}
                {w.asset}
              </>
            ),
          },
          { key: 'location', label: 'Location', render: (w) => w.location || 'Not recorded' },
          { key: 'form', label: 'Form reference', render: (w) => w.wiRef },
          { key: 'inspector', label: 'Assigned inspector', render: (w) => w.assignedTo },
          { key: 'due', label: 'Due date', render: (w) => w.dueDate?.slice(0, 10) || 'Not set' },
          {
            key: 'status',
            label: 'Status',
            render: (w) => (
              <span className={w.status === 'complete' ? 'text-success' : 'text-text-2'}>
                {w.status.replace('-', ' ')}
              </span>
            ),
          },
        ]}
      />
      <div className="flex justify-between items-center mt-5">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-sm text-text-2">
          Page {page} · {data?.total || 0} matching inspections
        </span>
        <Button variant="secondary" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
      <Modal
        open={show}
        onClose={() => setShow(false)}
        title="Create work order"
        footer={
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!form.assetId || !form.workInstructionId}
            onClick={() => void createOrder()}
          >
            Create work order
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text-2">
            One asset and one published form. A unique work-order number is assigned when saved.
          </p>
          <label className="field-label">
            Find asset
            <input
              aria-label="Find asset"
              className="field-input mt-2"
              value={assetSearch}
              onChange={(e) => {
                setAssetSearch(e.target.value)
                setForm((p) => ({ ...p, assetId: '', workInstructionId: '' }))
              }}
              placeholder="Search asset number, name or location"
            />
          </label>
          <label className="field-label">
            Asset
            <select
              aria-label="Asset"
              className="field-input mt-2"
              value={form.assetId}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  assetId: e.target.value,
                  workInstructionId: '',
                  assignedTo: '',
                }))
              }
            >
              <option value="">Select an asset</option>
              {assetPage?.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.assetNumber} · {a.name}
                </option>
              ))}
            </select>
          </label>
          {asset && (
            <dl className="rounded-lg bg-bg-3 p-4 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-text-2">Asset number</dt>
              <dd>{asset.assetNumber}</dd>
              <dt className="text-text-2">Asset name</dt>
              <dd>{asset.name}</dd>
              <dt className="text-text-2">Location</dt>
              <dd>{asset.location || 'Not recorded'}</dd>
              <dt className="text-text-2">Department</dt>
              <dd>
                {departments.find((d) => d.id === asset.departmentId)?.name || 'Not recorded'}
              </dd>
            </dl>
          )}
          <label className="field-label">
            Inspection form
            <select
              aria-label="Inspection form"
              className="field-input mt-2"
              disabled={!asset}
              value={form.workInstructionId}
              onChange={(e) => setForm((p) => ({ ...p, workInstructionId: e.target.value }))}
            >
              <option value="">Select a published form</option>
              {usable.map((f) => (
                <option key={f.dbId} value={f.dbId}>
                  {f.id} · {f.title} · {f.revision}
                </option>
              ))}
            </select>
          </label>
          {asset && !usable.length && (
            <p className="text-sm text-warning">
              No usable published forms in this asset’s department. Publish a form before creating
              the inspection.
            </p>
          )}
          <label className="field-label">
            Assigned inspector
            <select
              aria-label="Assigned inspector"
              className="field-input mt-2"
              value={form.assignedTo}
              onChange={(e) => setForm((p) => ({ ...p, assignedTo: e.target.value }))}
            >
              <option value="">Assign later</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="field-label">
              Priority
              <select
                className="field-input mt-2"
                value={form.priority}
                onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
              >
                {['low', 'medium', 'high', 'critical'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Due date
              <input
                type="date"
                className="field-input mt-2"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
              />
            </label>
          </div>
          <label className="field-label">
            Notes
            <textarea
              className="field-input mt-2"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </label>
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </AppLayout>
  )
}
