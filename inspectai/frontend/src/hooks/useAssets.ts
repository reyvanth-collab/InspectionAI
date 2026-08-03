import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { Asset, AssetCriticality, AssetStatus } from '@/types'

interface DBAsset {
  id: string
  asset_number: string
  name: string
  category: string | null
  location: string | null
  status: string
  criticality: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  install_date: string | null
  next_pm_date: string | null
  notes: string | null
  open_work_orders?: number | string | null
  completed_inspections?: number | string | null
  last_inspected_at?: string | null
}

export interface AssetSummary {
  total: number
  active: number
  maintenance: number
  highRisk: number
  pmDueSoon: number
}

export interface AssetInput {
  assetNumber: string
  name: string
  category?: string
  location?: string
  status: AssetStatus
  criticality: AssetCriticality
  manufacturer?: string
  model?: string
  serialNumber?: string
  installDate?: string
  nextPmDate?: string
  notes?: string
}

function toAsset(row: DBAsset): Asset {
  return {
    id: row.id,
    assetNumber: row.asset_number,
    name: row.name,
    category: row.category ?? '',
    location: row.location ?? '',
    status: row.status as AssetStatus,
    criticality: row.criticality as AssetCriticality,
    manufacturer: row.manufacturer ?? '',
    model: row.model ?? '',
    serialNumber: row.serial_number ?? '',
    installDate: row.install_date ?? '',
    nextPmDate: row.next_pm_date ?? '',
    notes: row.notes ?? '',
    openWorkOrders: Number(row.open_work_orders ?? 0),
    completedInspections: Number(row.completed_inspections ?? 0),
    lastInspectedAt: row.last_inspected_at ?? '',
  }
}

export interface AssetPage {
  items: Asset[]
  page: number
  pageSize: number
  hasMore: boolean
}

export function useAssets(filters: { search?: string; status?: string; criticality?: string; page?: number } = {}) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['assets', filters],
    enabled: !!user,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.status && filters.status !== 'all') params.set('status', filters.status)
      if (filters.criticality && filters.criticality !== 'all') params.set('criticality', filters.criticality)
      if (filters.page) params.set('page', String(filters.page))
      params.set('pageSize', '50')
      const suffix = params.toString() ? `?${params.toString()}` : ''
      const res = await api.get<{ data: DBAsset[]; meta?: { page: number; pageSize: number; hasMore: boolean } }>(`/assets${suffix}`)
      return {
        items: res.data.data.map(toAsset),
        page: res.data.meta?.page ?? filters.page ?? 1,
        pageSize: res.data.meta?.pageSize ?? 50,
        hasMore: res.data.meta?.hasMore ?? false,
      } satisfies AssetPage
    },
  })
}

export function useAssetSummary() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['assets-summary'],
    enabled: !!user,
    queryFn: async () => {
      const res = await api.get<{
        data: { total: number | string; active: number | string; maintenance: number | string; high_risk: number | string; pm_due_soon: number | string }
      }>('/assets/summary')
      return {
        total: Number(res.data.data.total ?? 0),
        active: Number(res.data.data.active ?? 0),
        maintenance: Number(res.data.data.maintenance ?? 0),
        highRisk: Number(res.data.data.high_risk ?? 0),
        pmDueSoon: Number(res.data.data.pm_due_soon ?? 0),
      } satisfies AssetSummary
    },
  })
}

export function useCreateAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AssetInput) => {
      const res = await api.post<{ data: DBAsset }>('/assets', input)
      return toAsset(res.data.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['assets-summary'] })
    },
  })
}

export function useUpdateAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<AssetInput> & { id: string }) => {
      const res = await api.patch<{ data: DBAsset }>(`/assets/${id}`, input)
      return toAsset(res.data.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['assets-summary'] })
    },
  })
}
