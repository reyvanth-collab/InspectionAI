import type { User } from '@/types'
export function can(user: User | null | undefined, capability: string) {
  if (!user) return false
  const defaults: Record<string, string[]> = {
    admin: ['administrator'],
    approver: ['form_author', 'form_approver', 'viewer', 'asset_manager', 'work_order_manager'],
    inspector: ['inspector'],
    viewer: ['viewer'],
  }
  const caps = user.capabilities ?? defaults[user.role] ?? []
  return caps.includes('administrator') || caps.includes(capability)
}
export const formStatus = (status: string) =>
  ({
    draft: 'Draft',
    pending_approval: 'Awaiting approval',
    active: 'Published',
    expiring: 'Published · expiring',
    expired: 'Expired',
    superseded: 'Previous version',
  })[status] ?? status
