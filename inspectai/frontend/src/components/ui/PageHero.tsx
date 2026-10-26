import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
interface HeroStat {
  label: string
  value: string | number
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'
}
export function PageHero({
  title,
  description,
  actions,
  className,
}: {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
  stats?: HeroStat[]
  actions?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'page-heading flex flex-wrap items-start justify-between gap-4 mb-6',
        className,
      )}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-text-2 mt-2 max-w-2xl">{description}</p>
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </section>
  )
}
export function MetricTile({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  tone?: HeroStat['tone']
}) {
  return (
    <div className="bg-bg-2 border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm text-text-2">
        <Icon size={16} />
        {label}
      </div>
      <p className="text-2xl font-semibold mt-3 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-text-2 mt-1">{sub}</p>}
    </div>
  )
}
