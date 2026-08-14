import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, AlertTriangle, Boxes, CalendarClock, Edit3, Plus, Search, Wrench, type LucideIcon } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useAssets, useAssetSummary, useCreateAsset, useUpdateAsset } from '@/hooks/useAssets'
import type { Asset, AssetCriticality, AssetStatus } from '@/types'

const INPUT = 'w-full px-3 py-2 bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'
const LABEL = 'block text-[11px] font-medium text-text-2 uppercase tracking-[0.07em] mb-1'

const STATUS_BADGE: Record<AssetStatus, 'active' | 'expiring' | 'expired'> = {
  active: 'active',
  maintenance: 'expiring',
  retired: 'expired',
}

const CRITICALITY_BADGE: Record<AssetCriticality, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'high',
}

const emptyForm = {
  assetNumber: '',
  name: '',
  category: '',
  location: '',
  status: 'active' as AssetStatus,
  criticality: 'medium' as AssetCriticality,
  manufacturer: '',
  model: '',
  serialNumber: '',
  installDate: '',
  nextPmDate: '',
  notes: '',
}

export default function Assets() {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [criticality, setCriticality] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(emptyForm)

  const filters = useMemo(() => ({ search, status, criticality, page }), [search, status, criticality, page])
  const { data: assetPage, isLoading } = useAssets(filters)
  const assets = assetPage?.items ?? []
  const { data: summary } = useAssetSummary()
  const createAsset = useCreateAsset()
  const updateAsset = useUpdateAsset()

  useEffect(() => { setPage(1) }, [search, status, criticality])

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }))

  const openEdit = (asset: Asset) => {
    setEditingAsset(asset)
    setForm({
      assetNumber: asset.assetNumber,
      name: asset.name,
      category: asset.category,
      location: asset.location,
      status: asset.status,
      criticality: asset.criticality,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serialNumber: asset.serialNumber,
      installDate: asset.installDate,
      nextPmDate: asset.nextPmDate,
      notes: asset.notes,
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingAsset(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Asset name is required', 'error'); return }
    if (form.installDate && form.nextPmDate && form.nextPmDate < form.installDate) {
      toast('Next PM date cannot be before install date', 'error'); return
    }
    try {
      if (editingAsset) {
        await updateAsset.mutateAsync({ id: editingAsset.id, ...form })
        toast('Asset updated', 'success')
      } else {
        if (!form.assetNumber.trim()) { toast('Asset number is required', 'error'); return }
        await createAsset.mutateAsync(form)
        toast('Asset created', 'success')
      }
      setPage(1)
      closeModal()
    } catch (e) {
      toast(e instanceof Error ? e.message : `Failed to ${editingAsset ? 'update' : 'create'} asset`, 'error')
    }
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Assets' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Assets</h1>
          <p className="text-[13px] text-text-2 mt-1">Asset registry, risk, and inspection readiness</p>
        </div>
        <Button variant="primary" onClick={() => { setEditingAsset(null); setForm(emptyForm); setShowModal(true) }}>
          <Plus size={15} /> New Asset
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Kpi icon={Boxes} label="Total" value={summary?.total ?? 0} />
        <Kpi icon={Activity} label="Active" value={summary?.active ?? 0} tone="success" />
        <Kpi icon={Wrench} label="Maintenance" value={summary?.maintenance ?? 0} tone="warning" />
        <Kpi icon={AlertTriangle} label="High Risk" value={summary?.highRisk ?? 0} tone="danger" />
        <Kpi icon={CalendarClock} label="PM Due 30d" value={summary?.pmDueSoon ?? 0} tone="accent" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search asset number, name, or location..."
                className={INPUT + ' pl-9'}
              />
            </div>
            <select value={status} onChange={e => setStatus(e.target.value)} className={INPUT + ' w-40'}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="retired">Retired</option>
            </select>
            <select value={criticality} onChange={e => setCriticality(e.target.value)} className={INPUT + ' w-40'}>
              <option value="all">All criticality</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </CardBody>
      </Card>

      <Card>
        {isLoading ? (
          <SkeletonTable rows={7} />
        ) : assets.length === 0 ? (
          <CardBody>
            <p className="text-[13px] text-text-3 text-center py-8">No assets found.</p>
          </CardBody>
        ) : (
          <>
            <div className="grid grid-cols-[130px_1.2fr_1fr_110px_110px_100px_120px_34px] gap-3 px-4 py-2 border-b border-border bg-bg-3">
            {['Asset #', 'Name', 'Location', 'Status', 'Risk', 'Open WO', 'Next PM', ''].map(h => (
                <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em]">{h}</span>
              ))}
            </div>
            {assets.map(asset => <AssetRow key={asset.id} asset={asset} onEdit={() => openEdit(asset)} />)}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-[11px] text-text-3">Page {page}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={!assetPage?.hasMore} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editingAsset ? 'Edit Asset' : 'New Asset'}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button variant="primary" loading={createAsset.isPending || updateAsset.isPending} onClick={handleSave}>
              {editingAsset ? 'Save Changes' : 'Create Asset'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Asset Number" required>
            <input value={form.assetNumber} onChange={set('assetNumber')} disabled={!!editingAsset} placeholder="e.g. ESC-NSL-001" className={INPUT + (editingAsset ? ' opacity-60' : '')} />
          </Field>
          <Field label="Asset Name" required>
            <input value={form.name} onChange={set('name')} placeholder="e.g. Escalator E-01" className={INPUT} />
          </Field>
          <Field label="Category">
            <input value={form.category} onChange={set('category')} placeholder="e.g. Escalator" className={INPUT} />
          </Field>
          <Field label="Location">
            <input value={form.location} onChange={set('location')} placeholder="e.g. Bishan MRT" className={INPUT} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={set('status')} className={INPUT}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="retired">Retired</option>
            </select>
          </Field>
          <Field label="Criticality">
            <select value={form.criticality} onChange={set('criticality')} className={INPUT}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <Field label="Manufacturer">
            <input value={form.manufacturer} onChange={set('manufacturer')} className={INPUT} />
          </Field>
          <Field label="Model">
            <input value={form.model} onChange={set('model')} className={INPUT} />
          </Field>
          <Field label="Serial Number">
            <input value={form.serialNumber} onChange={set('serialNumber')} className={INPUT} />
          </Field>
          <Field label="Install Date">
            <input type="date" value={form.installDate} onChange={set('installDate')} className={INPUT} />
          </Field>
          <Field label="Next PM Date">
            <input type="date" value={form.nextPmDate} onChange={set('nextPmDate')} className={INPUT} />
          </Field>
          <div className="col-span-2">
            <label className={LABEL}>Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={INPUT + ' resize-none'} />
          </div>
        </div>
      </Modal>
    </AppLayout>
  )
}

function AssetRow({ asset, onEdit }: { asset: Asset; onEdit: () => void }) {
  return (
    <div className="grid grid-cols-[130px_1.2fr_1fr_110px_110px_100px_120px_34px] gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 transition-colors">
      <span className="font-mono text-[12px] text-accent truncate">{asset.assetNumber}</span>
      <span className="text-[13px] text-text truncate">
        {asset.name}
        {asset.category && <span className="block text-[11px] text-text-3 mt-0.5">{asset.category}</span>}
      </span>
      <span className="text-[12px] text-text-2 truncate">{asset.location || '-'}</span>
      <span><Badge variant={STATUS_BADGE[asset.status]}>{asset.status}</Badge></span>
      <span><Badge variant={CRITICALITY_BADGE[asset.criticality]}>{asset.criticality}</Badge></span>
      <span className="font-mono text-[12px] text-text-2">{asset.openWorkOrders}</span>
      <span className="font-mono text-[11px] text-text-3">{asset.nextPmDate || '-'}</span>
      <button type="button" onClick={onEdit} title="Edit asset" className="text-text-3 hover:text-accent transition-colors">
        <Edit3 size={14} />
      </button>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label} {required && <span className="text-danger">*</span>}</label>
      {children}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, tone = 'default' }: {
  icon: LucideIcon
  label: string
  value: number
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent'
}) {
  const color = tone === 'success' ? 'text-success bg-success-bg border-success-border'
    : tone === 'warning' ? 'text-warning bg-warning-bg border-warning-border'
    : tone === 'danger' ? 'text-danger bg-danger-bg border-danger-border'
    : tone === 'accent' ? 'text-accent bg-accent-bg border-accent-bd'
    : 'text-text-2 bg-bg-2 border-border'
  return (
    <div className={`rounded-[10px] border p-4 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-[0.07em] font-medium opacity-80">{label}</p>
        <Icon size={15} className="opacity-70" />
      </div>
      <p className="text-[26px] font-bold leading-none text-text">{value}</p>
    </div>
  )
}
