import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { WorkInstruction } from '@/types'

interface DBWorkInstruction {
  id: string
  wi_number: string
  title: string
  description: string | null
  category: string | null
  revision: string
  status: string
  effective_date: string | null
  expiry_date: string | null
  pdf_url: string | null
  users: { name: string } | null
}

function toWorkInstruction(row: DBWorkInstruction): WorkInstruction {
  const today = new Date()
  const expiry = row.expiry_date ? new Date(row.expiry_date) : null
  const daysRemaining = expiry
    ? Math.round((expiry.getTime() - today.getTime()) / 86_400_000)
    : 0

  return {
    id:             row.wi_number,
    dbId:           row.id,
    title:          row.title,
    revision:       row.revision,
    status:         row.status as WorkInstruction['status'],
    owner:          row.users?.name ?? '—',
    effectiveDate:  row.effective_date ?? '',
    expiryDate:     row.expiry_date ?? '',
    daysRemaining,
    checklistItems: [],
  }
}

export function useWorkInstructions(search?: string) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['work-instructions', search],
    enabled:  !!user,
    queryFn:  async () => {
      let query = supabase
        .from('work_instructions')
        .select('*, users ( name )')
        .order('expiry_date', { ascending: true, nullsFirst: false })

      if (search) {
        query = query.or(`title.ilike.%${search}%,wi_number.ilike.%${search}%`)
      }

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data as DBWorkInstruction[]).map(toWorkInstruction)
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
          *,
          users ( name, email ),
          wi_checklist_items ( * ),
          wi_revision_history ( * )
        `)
        .eq('id', dbId)
        .single()

      if (error) throw new Error(error.message)
      return data
    },
  })
}
