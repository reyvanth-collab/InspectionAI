import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'
import { can } from '@/lib/permissions'

export interface TenantUser {
  id: string
  name: string
  email: string
  staffId: string
  role: UserRole
}

interface DBUser {
  id: string
  name: string
  email: string
  staff_id: string
  role: string
}
const toTenantUser = (r: DBUser): TenantUser => ({
  id: r.id,
  name: r.name,
  email: r.email,
  staffId: r.staff_id,
  role: r.role as UserRole,
})

export function useUsers() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['users'],
    enabled: !!user && user.role.toLowerCase() === 'admin',
    queryFn: async (): Promise<TenantUser[]> => {
      const res = await api.get<{ data: DBUser[] }>('/users')
      return res.data.data.map(toTenantUser)
    },
  })
}

export function useApprovers(departmentId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['approvers', departmentId],
    enabled: !!user && can(user, 'form_author'),
    queryFn: async (): Promise<TenantUser[]> => {
      const res = await api.get<{ data: DBUser[] }>(
        `/users/approvers${departmentId ? '?departmentId=' + encodeURIComponent(departmentId) : ''}`,
      )
      return res.data.data.map(toTenantUser)
    },
  })
}

export function useAssignableUsers(departmentId?: string, enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['assignable-users', departmentId],
    enabled: !!user && enabled && can(user, 'work_order_manager'),
    queryFn: async (): Promise<TenantUser[]> => {
      const res = await api.get<{ data: DBUser[] }>(
        `/users/assignable${departmentId ? '?departmentId=' + encodeURIComponent(departmentId) : ''}`,
      )
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
