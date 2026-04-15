import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  maxWidth?: string
}

export function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-[560px]' }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className={cn(
          'bg-bg-2 border border-border-2 rounded-[12px] w-full max-h-[90vh] overflow-y-auto',
          maxWidth
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-[18px] border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-2 text-xl leading-none hover:text-text transition-colors bg-transparent border-none cursor-pointer px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex gap-2 justify-end px-5 py-4 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
