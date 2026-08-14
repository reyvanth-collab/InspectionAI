import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface HeroStat {
  label: string
  value: string | number
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'
}

const toneClass: Record<NonNullable<HeroStat['tone']>, string> = {
  accent:  'text-accent bg-accent-bg border-accent-bd',
  success: 'text-success bg-success-bg border-success-border',
  warning: 'text-warning bg-warning-bg border-warning-border',
  danger:  'text-danger bg-danger-bg border-danger-border',
  info:    'text-info bg-info-bg border-info-border',
}

export function PageHero({
  eyebrow,
  title,
  description,
  icon: Icon,
  stats = [],
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
    <section className={cn(
      'premium-ring relative mb-6 overflow-hidden rounded-[18px] border border-border bg-[radial-gradient(circle_at_top_left,rgba(104,167,255,0.26),transparent_34%),linear-gradient(135deg,rgba(18,25,38,0.92),rgba(11,15,23,0.88)_48%,rgba(20,62,72,0.76))] p-6 shadow-lg',
      className
    )}>
      <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border border-white/10 bg-white/[0.035]" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-bd bg-accent-bg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-accent">
            <Icon size={14} />
            {eyebrow}
          </div>
          <h1 className="max-w-[820px] text-[32px] font-semibold leading-tight tracking-[-0.9px] text-text">
            {title}
          </h1>
          <p className="mt-2 max-w-[720px] text-[14px] leading-6 text-text-2">
            {description}
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          {actions && <div className="flex flex-wrap justify-start gap-2 lg:justify-end">{actions}</div>}
          {stats.length > 0 && (
            <div className="grid min-w-[280px] grid-cols-2 gap-2">
              {stats.map(stat => (
                <div key={stat.label} className={cn(
                  'rounded-[12px] border px-3 py-3 backdrop-blur',
                  toneClass[stat.tone ?? 'accent']
                )}>
                  <p className="text-[10px] uppercase tracking-[0.11em] opacity-75">{stat.label}</p>
                  <p className="mt-1 font-mono text-[22px] font-semibold leading-none">{stat.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function MetricTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'accent',
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  tone?: HeroStat['tone']
}) {
  return (
    <div className="surface-panel premium-ring rounded-[14px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-2">{label}</p>
        <span className={cn('grid h-9 w-9 place-items-center rounded-[11px] border', toneClass[tone ?? 'accent'])}>
          <Icon size={17} />
        </span>
      </div>
      <p className="font-mono text-[30px] font-bold leading-none tracking-[-1px] text-text">{value}</p>
      {sub && <p className="mt-2 text-[11px] text-text-3">{sub}</p>}
    </div>
  )
}
