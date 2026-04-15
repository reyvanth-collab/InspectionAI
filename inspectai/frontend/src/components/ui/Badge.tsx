import { cn } from '@/lib/cn'

export type BadgeVariant =
  | 'active' | 'expiring' | 'expired' | 'draft' | 'superseded'
  | 'pending' | 'pending_approval' | 'approved' | 'rejected'
  | 'open' | 'complete'
  | 'high' | 'medium' | 'low'
  | 'ai'

const variantClasses: Record<BadgeVariant, string> = {
  active:           'bg-success-bg text-success border border-success-border',
  expiring:         'bg-warning-bg text-warning border border-warning-border',
  expired:          'bg-danger-bg text-danger border border-danger-border',
  draft:            'bg-bg-3 text-text-2 border border-border-2',
  superseded:       'bg-bg-3 text-text-3 border border-border-2',
  pending:          'bg-violet-bg text-violet border border-violet-border',
  pending_approval: 'bg-violet-bg text-violet border border-violet-border',
  approved:         'bg-success-bg text-success border border-success-border',
  rejected:         'bg-danger-bg text-danger border border-danger-border',
  open:             'bg-warning-bg text-warning border border-warning-border',
  complete:         'bg-success-bg text-success border border-success-border',
  high:             'bg-danger-bg text-danger border border-danger-border',
  medium:           'bg-warning-bg text-warning border border-warning-border',
  low:              'bg-bg-3 text-text-2 border border-border-2',
  ai:               'bg-accent-bg text-accent border border-accent-bd',
}

interface BadgeProps {
  variant: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium px-[9px] py-[3px] rounded-full whitespace-nowrap',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
