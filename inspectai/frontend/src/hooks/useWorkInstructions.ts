import { fetchPages } from '@/lib/pages'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { WorkInstruction } from '@/types'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMPTY_DATE_TEXT =
  /^(n\/a|na|nil|none|null|unknown|not stated|not stated in source|not mentioned|not available|not applicable)$/i

function normalizeDateInput(value?: string) {
  const text = String(value ?? '').trim()
  if (!text || EMPTY_DATE_TEXT.test(text)) return undefined
  if (ISO_DATE_RE.test(text)) return text
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10)
}

interface DBWorkInstruction {
  id: string
  wi_number: string
  title: string
  category: string | null
  revision: string
  status: string
  effective_date: string | null
  expiry_date: string | null
  owner_name: string | null
  department_id?: string
  owner_id?: string
  checklist_item_count?: number | string | null
  checkable_item_count?: number | string | null
}

function toWorkInstruction(row: DBWorkInstruction): WorkInstruction {
  const today = new Date()
  const expiry = row.expiry_date ? new Date(row.expiry_date) : null
  const daysRemaining = expiry ? Math.round((expiry.getTime() - today.getTime()) / 86_400_000) : 0
  return {
    id: row.wi_number,
    departmentId: row.department_id,
    ownerId: row.owner_id,
    dbId: row.id,
    title: row.title,
    category: row.category ?? undefined,
    revision: row.revision,
    status: row.status as WorkInstruction['status'],
    owner: row.owner_name ?? '-',
    effectiveDate: row.effective_date ?? '',
    expiryDate: row.expiry_date ?? '',
    daysRemaining,
    checklistItemCount: Number(row.checklist_item_count ?? 0),
    checkableItemCount: Number(row.checkable_item_count ?? row.checklist_item_count ?? 0),
    checklistItems: [],
  }
}

export function useWorkInstructions(search?: string, enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['work-instructions', search],
    enabled: !!user && enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : ''
      const rows = await fetchPages<DBWorkInstruction>(`/work-instructions${params}`)
      return rows.map(toWorkInstruction)
    },
  })
}

export function useWorkInstruction(dbId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['work-instruction', dbId],
    enabled: !!user && !!dbId,
    queryFn: async () => {
      const res = await api.get<{ data: Record<string, unknown> }>(`/work-instructions/${dbId}`)
      return res.data.data
    },
  })
}

export interface CreateWIInput {
  wiNumber: string
  title: string
  description?: string
  category?: string
  revision: string
  effectiveDate: string
  expiryDate: string
}

export function useCreateWorkInstruction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateWIInput) => {
      const res = await api.post<{ data: Record<string, unknown> }>('/work-instructions', {
        wiNumber: input.wiNumber,
        title: input.title,
        description: input.description,
        category: input.category,
        revision: input.revision,
        effectiveDate: input.effectiveDate,
        expiryDate: input.expiryDate,
        status: 'draft',
      })
      return res.data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-instructions'] }),
  })
}

export function useSubmitForApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ wiDbId, approverIds }: { wiDbId: string; approverIds: string[] }) => {
      const res = await api.post<{ data: Record<string, unknown> }>(
        `/work-instructions/${wiDbId}/submit-approval`,
        { approverIds },
      )
      return res.data.data
    },
    onSuccess: (_data, { wiDbId }) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['work-instruction', wiDbId] })
      qc.invalidateQueries({ queryKey: ['wi-builder', wiDbId] })
    },
  })
}

export function useCreateWIRevision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ wiDbId, changeSummary }: { wiDbId: string; changeSummary?: string }) => {
      const res = await api.post<{ data: Record<string, unknown> }>(
        `/work-instructions/${wiDbId}/revise`,
        {
          changeSummary,
        },
      )
      return res.data.data
    },
    onSuccess: (_data, { wiDbId }) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      qc.invalidateQueries({ queryKey: ['work-instruction', wiDbId] })
    },
  })
}

// ── WI Builder hooks ─────────────────────────────────────────────

export function useWIBuilderData(dbId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['wi-builder', dbId],
    enabled: !!user && !!dbId,
    queryFn: async () => {
      const res = await api.get<{ data: Record<string, unknown> }>(`/work-instructions/${dbId}`)
      return res.data.data
    },
  })
}

export interface ChecklistItemInput {
  id?: string
  itemNo: string
  description: string
  acceptanceCriteria?: string
  category?: string
  fieldType?: string
  required?: boolean
  placeholder?: string
  optionsJson?: string
  unit?: string
  minValue?: number
  maxValue?: number
  conditionalJson?: string
  sourcePage?: number | null
  sourceText?: string
  aiConfidence?: number | null
  aiWarnings?: string[]
  layoutJson?: string
  sortOrder: number
}

export interface SaveWIInput {
  departmentId?: string
  dbId?: string
  wiNumber: string
  title: string
  description?: string
  category?: string
  revision: string
  effectiveDate?: string
  expiryDate?: string
  status?: string
  checklistItems: ChecklistItemInput[]
}

export function useSaveWIWithItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveWIInput) => {
      const body = {
        wiNumber: input.wiNumber,
        title: input.title,
        description: input.description,
        category: input.category,
        revision: input.revision,
        effectiveDate: normalizeDateInput(input.effectiveDate),
        expiryDate: normalizeDateInput(input.expiryDate),
        departmentId: input.departmentId,
        status: input.status ?? 'draft',
        checklistItems: input.checklistItems,
      }
      if (input.dbId) {
        const res = await api.put<{ data: Record<string, unknown> }>(
          `/work-instructions/${input.dbId}`,
          body,
        )
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
