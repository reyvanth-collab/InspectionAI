import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'

export interface TenantUser {
  id:       string
  name:     string
  email:    string
  staffId:  string
  role:     UserRole
}

export function useUsers() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['users'],
    enabled:  !!user && user.role === 'admin',
    queryFn:  async (): Promise<TenantUser[]> => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email, staff_id, role')
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []).map(r => ({
        id:      r.id as string,
        name:    r.name as string,
        email:   r.email as string,
        staffId: r.staff_id as string,
        role:    r.role as UserRole,
      }))
    },
  })
}

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const { error } = await supabase
        .from('users')
        .update({ role })
        .eq('id', userId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}
