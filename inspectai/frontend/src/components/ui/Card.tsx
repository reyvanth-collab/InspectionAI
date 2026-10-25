import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

interface CardProps { children: ReactNode; className?: string }
interface CardHeaderProps { children: ReactNode; className?: string; actions?: ReactNode }
interface CardBodyProps { children: ReactNode; className?: string }
interface CardFooterProps { children: ReactNode; className?: string }

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn('surface-panel rounded-[12px] overflow-hidden mb-4', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ children, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('px-[18px] py-[14px] border-b border-border flex items-center justify-between gap-3 flex-wrap bg-bg-3/40', className)}>
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-2">{children}</span>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ children, className }: CardBodyProps) {
  return (
    <div className={cn('p-[18px]', className)}>{children}</div>
  )
}

export function CardFooter({ children, className }: CardFooterProps) {
  return (
    <div className={cn('px-[18px] py-[14px] border-t border-border flex gap-2 justify-end', className)}>
      {children}
    </div>
  )
}
