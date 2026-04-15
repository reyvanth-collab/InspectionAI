import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

interface Column<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => ReactNode
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  onRowClick?: (row: T) => void
  emptyMessage?: string
  className?: string
}

export function Table<T extends { id: string | number }>({
  columns, rows, onRowClick, emptyMessage = 'No data', className,
}: TableProps<T>) {
  return (
    <div className={cn('bg-bg-2 border border-border rounded-[10px] overflow-hidden overflow-x-auto', className)}>
      <table className="w-full border-collapse min-w-[600px]">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                className="text-[11px] font-medium text-text-3 uppercase tracking-[0.07em] px-[14px] py-[10px] text-left border-b border-border whitespace-nowrap"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center text-[13px] text-text-3 py-10"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'border-b border-border last:border-0 text-[13px] transition-colors duration-100',
                  onRowClick && 'cursor-pointer hover:bg-bg-3'
                )}
              >
                {columns.map(col => (
                  <td
                    key={String(col.key)}
                    className={cn('px-[14px] py-[13px] align-middle', col.className)}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key as string] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
