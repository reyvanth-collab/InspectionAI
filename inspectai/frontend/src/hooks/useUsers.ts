import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'

export interface TenantUser {
  id:       string
  name:     string
  email:    string
  staffId:  string
  role:     UserRole
}

interface DBUser { id: string; name: string; email: string; staff_id: string; role: string }
const toTenantUser = (r: DBUser): TenantUser => ({
  id: r.id, name: r.name, email: r.email, staffId: r.staff_id, role: r.role as UserRole,
})

export function useUsers() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['users'],
    enabled:  !!user && user.role.toLowerCase() === 'admin',
    queryFn:  async (): Promise<TenantUser[]> => {
      const res = await api.get<{ data: DBUser[] }>('/users')
      return res.data.data.map(toTenantUser)
    },
  })
}

export function useApprovers() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['approvers'],
    enabled:  !!user,
    queryFn:  async (): Promise<TenantUser[]> => {
      const res = await api.get<{ data: DBUser[] }>('/users/approvers')
      return res.data.data.map(toTenantUser)
    },
  })
}

export function useAssignableUsers() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['assignable-users'],
    enabled:  !!user,
    queryFn:  async (): Promise<TenantUser[]> => {
      const res = await api.get<{ data: DBUser[] }>('/users/assignable')
      return res.data.data.map(toTenantUser)
    },
  })
}

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      await api.patch(`/users/${userId}/role`, { role })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}
