import { cn } from '@/lib/cn'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  color?: 'green' | 'red' | 'amber' | 'accent' | 'default'
}

const colorClasses = {
  green:   'text-success',
  red:     'text-danger',
  amber:   'text-warning',
  accent:  'text-accent',
  default: 'text-text',
}

export function StatCard({ label, value, sub, color = 'default' }: StatCardProps) {
  return (
    <div className="bg-bg-2 border border-border rounded-[10px] px-[18px] py-4">
      <p className="text-[11px] text-text-2 uppercase tracking-[0.07em] mb-2">{label}</p>
      <p className={cn('text-[28px] font-semibold tracking-[-1px] font-mono', colorClasses[color])}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-text-3 mt-1">{sub}</p>}
    </div>
  )
}
