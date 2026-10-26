import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
export interface Department {
  id: string
  code: string
  name: string
  active: boolean
}
export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get<{ data: Department[] }>('/departments')).data.data,
  })
}
