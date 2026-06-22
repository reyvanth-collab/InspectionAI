import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { WorkInstruction } from '@/types'

interface DBWorkInstruction {
  id:             string
  wi_number:      string
  title:          string
  category:       string | null
  revision:       string
  status:         string
  effective_date: string | null
  expiry_date:    string | null
  owner_name:     string | null
}

function toWorkInstruction(row: DBWorkInstruction): WorkInstruction {
  const today = new Date()
  const expiry = row.expiry_date ? new Date(row.expiry_date) : null
  const daysRemaining = expiry ? Math.round((expiry.getTime() - today.getTime()) / 86_400_000) : 0
  return {
    id:            row.wi_number,
    dbId:          row.id,
    title:         row.title,
    revision:      row.revision,
    status:        row.status as WorkInstruction['status'],
    owner:         row.owner_name ?? '—',
    effectiveDate: row.effective_date ?? '',
    expiryDate:    row.expiry_date ?? '',
    daysRemaining,
    checklistItems: [],
  }
}

export function useWorkInstructions(search?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey:        ['work-instructions', search],
    enabled:         !!user,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : ''
      const res = await api.get<{ data: DBWorkInstruction[] }>(`/work-instructions${params}`)
      return res.data.data.map(toWorkInstruction)
    },
  })
}

export function useWorkInstruction(dbId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['work-instruction', dbId],
    enabled:  !!user && !!dbId,
    queryFn:  async () => {
      const res = await api.get<{ data: Record<string, unknown> }>(`/work-instructions/${dbId}`)
      return res.data.data
    },
  })
}

export interface CreateWIInput {
  wiNumber:      string
  title:         string
  description?:  string
  category?:     string
  revision:      string
  effectiveDate: string
  expiryDate:    string
}

export function useCreateWorkInstruction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateWIInput) => {
      const res = await api.post<{ data: Record<string, unknown> }>('/work-instructions', {
        wiNumber: input.wiNumber, title: input.title, description: input.description,
        category: input.category, revision: input.revision,
        effectiveDate: input.effectiveDate, expiryDate: input.expiryDate, status: 'draft',
      })
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-instructions'] }),
  })
}

export function useUpdateWorkInstruction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dbId, ...input }: CreateWIInput & { dbId: string }) => {
      await api.patch(`/work-instructions/${dbId}`, {
        wiNumber: input.wiNumber, title: input.title, description: input.description,
        category: input.category, revision: input.revision,
        effectiveDate: input.effectiveDate, expiryDate: input.expiryDate,
      })
    },
    onSuccess: (_d, { dbId }) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      qc.invalidateQueries({ queryKey: ['work-instruction', dbId] })
    },
  })
}

export function useSubmitForApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ wiDbId, approverIds }: { wiDbId: string; approverIds: string[] }) => {
      await api.post(`/work-instructions/${wiDbId}/submit-approval`, { approverIds })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })
}

// ── WI Builder hooks ─────────────────────────────────────────────

export function useWIBuilderData(dbId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['wi-builder', dbId],
    enabled:  !!user && !!dbId,
    queryFn:  async () => {
      const res = await api.get<{ data: Record<string, unknown> }>(`/work-instructions/${dbId}`)
      return res.data.data
    },
  })
}

export interface ChecklistItemInput {
  itemNo:              string
  description:         string
  acceptanceCriteria?: string
  category?:           string
  fieldType?:          string
  required?:           boolean
  placeholder?:        string
  optionsJson?:        string
  unit?:               string
  minValue?:           number
  maxValue?:           number
  conditionalJson?:    string
  sourcePage?:         number | null
  sourceText?:         string
  aiConfidence?:       number | null
  aiWarnings?:         string[]
  sortOrder:           number
}

export interface SaveWIInput {
  dbId?:          string
  wiNumber:       string
  title:          string
  description?:   string
  category?:      string
  revision:       string
  effectiveDate?: string
  expiryDate?:    string
  status?:        string
  checklistItems: ChecklistItemInput[]
}

export function useSaveWIWithItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveWIInput) => {
      const body = {
        wiNumber: input.wiNumber, title: input.title, description: input.description,
        category: input.category, revision: input.revision,
        effectiveDate: input.effectiveDate || undefined, expiryDate: input.expiryDate || undefined,
        status: input.status ?? 'draft', checklistItems: input.checklistItems,
      }
      if (input.dbId) {
        const res = await api.put<{ data: Record<string, unknown> }>(`/work-instructions/${input.dbId}`, body)
        return res.data.data
      } else {
        const res = await api.post<{ data: Record<string, unknown> }>('/work-instructions', body)
        return res.data.data
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      if (input.dbId) qc.invalidateQueries({ queryKey: ['wi-builder', input.dbId] })
    },
  })
}
