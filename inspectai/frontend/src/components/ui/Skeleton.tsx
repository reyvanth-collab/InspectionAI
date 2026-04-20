import { cn } from '@/lib/cn'

interface SkeletonProps { className?: string }

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('rounded-[6px] shimmer', className)} />
}

export function SkeletonCard() {
  return (
    <div className="rounded-[10px] border border-border bg-bg-2 p-4 flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  )
}
