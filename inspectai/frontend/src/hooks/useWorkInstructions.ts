import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { WorkInstruction } from '@/types'

interface DBWorkInstruction {
  id: string
  wi_number: string
  title: string
  category: string | null
  revision: string
  status: string
  effective_date: string | null
  expiry_date: string | null
  users: { name: string } | null
}

function toWorkInstruction(row: DBWorkInstruction): WorkInstruction {
  const today = new Date()
  const expiry = row.expiry_date ? new Date(row.expiry_date) : null
  const daysRemaining = expiry
    ? Math.round((expiry.getTime() - today.getTime()) / 86_400_000)
    : 0

  return {
    id:            row.wi_number,
    dbId:          row.id,
    title:         row.title,
    revision:      row.revision,
    status:        row.status as WorkInstruction['status'],
    owner:         row.users?.name ?? '—',
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
      let query = supabase
        .from('work_instructions')
        .select('id, wi_number, title, category, revision, status, effective_date, expiry_date, users(name)')
        .order('expiry_date', { ascending: true, nullsFirst: false })
        .limit(200)

      if (search) {
        query = query.or(`title.ilike.%${search}%,wi_number.ilike.%${search}%`)
      }

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data as unknown as DBWorkInstruction[]).map(toWorkInstruction)
    },
  })
}

export function useWorkInstruction(dbId: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['work-instruction', dbId],
    enabled:  !!user && !!dbId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select(`
          id, wi_number, title, description, category, revision, status,
          effective_date, expiry_date, pdf_url,
          users ( name, email ),
          wi_checklist_items ( id, item_no, description, acceptance_criteria, category, sort_order ),
          wi_revision_history ( id, revision, change_summary, effective_date, approved_by )
        `)
        .eq('id', dbId)
        .single()

      if (error) throw new Error(error.message)
      return data
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
  const qc       = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: CreateWIInput) => {
      const { data, error } = await supabase
        .from('work_instructions')
        .insert({
          wi_number:      input.wiNumber,
          title:          input.title,
          description:    input.description || null,
          category:       input.category || null,
          revision:       input.revision,
          effective_date: input.effectiveDate || null,
          expiry_date:    input.expiryDate || null,
          status:         'draft',
          owner_id:       user?.id,
          tenant_id:      user?.tenantId || undefined,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-instructions'] }),
  })
}

export function useUpdateWorkInstruction() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ dbId, ...input }: CreateWIInput & { dbId: string }) => {
      const { error } = await supabase
        .from('work_instructions')
        .update({
          wi_number:      input.wiNumber,
          title:          input.title,
          description:    input.description || null,
          category:       input.category || null,
          revision:       input.revision,
          effective_date: input.effectiveDate || null,
          expiry_date:    input.expiryDate || null,
        })
        .eq('id', dbId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, { dbId }) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      qc.invalidateQueries({ queryKey: ['work-instruction', dbId] })
    },
  })
}

export function useSubmitForApproval() {
  const qc       = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ wiDbId, approverIds }: { wiDbId: string; approverIds: string[] }) => {
      // 1. Update WI status
      // 2. Create approval record
      // 3. Create approval steps
      // All in parallel where possible
      const [statusResult] = await Promise.all([
        supabase.from('work_instructions')
          .update({ status: 'pending_approval' })
          .eq('id', wiDbId),
      ])
      if (statusResult.error) throw new Error(statusResult.error.message)

      const { data: aprRecord, error: aprErr } = await supabase
        .from('approval_records')
        .insert({
          wi_id:        wiDbId,
          submitted_by: user?.id,
          tenant_id:    user?.tenantId || undefined,
          final_status: 'active',
          submitted_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (aprErr) throw new Error(aprErr.message)

      const steps = approverIds.map((approverId, i) => ({
        approval_record_id: aprRecord.id,
        step_number:        i + 1,
        label:              i === 0 ? 'Technical Review' : i === 1 ? 'Manager Approval' : `Step ${i + 1}`,
        approver_id:        approverId,
        status:             i === 0 ? 'active' : 'wait',
        tenant_id:          user?.tenantId || undefined,
      }))

      const { error: stepsErr } = await supabase.from('approval_steps').insert(steps)
      if (stepsErr) throw new Error(stepsErr.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })
}

// ── WI Builder hooks (use Express API, not Supabase) ─────────────

/** Fetches full WI data including checklist items for editing in the builder. */
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
  sortOrder:           number
}

export interface SaveWIInput {
  dbId?:          string          // present when editing
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

/** Creates (POST) or fully replaces (PUT) a WI with its checklist items. */
export function useSaveWIWithItems() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveWIInput) => {
      const body = {
        wiNumber:       input.wiNumber,
        title:          input.title,
        description:    input.description,
        category:       input.category,
        revision:       input.revision,
        effectiveDate:  input.effectiveDate || undefined,
        expiryDate:     input.expiryDate || undefined,
        status:         input.status ?? 'draft',
        checklistItems: input.checklistItems,
      }
      if (input.dbId) {
        const res = await api.put<{ data: Record<string, unknown> }>(`/work-instructions/${input.dbId}`, body)
        return res.data.data
      } else {
        const res = await api.post<{ data: Record<string, unknown> }>(`/work-instructions`, body)
        return res.data.data
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] })
      if (input.dbId) qc.invalidateQueries({ queryKey: ['wi-builder', input.dbId] })
    },
  })
}
