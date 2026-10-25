import { cn } from '@/lib/cn'
import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClasses: Record<ButtonVariant, string> = {
  primary:   'bg-gradient-to-r from-accent to-accent-2 text-white border border-white/10 shadow-[0_10px_26px_rgba(45,125,255,0.24)] hover:brightness-110',
  secondary: 'bg-bg-2/70 text-text border border-border-2 hover:border-accent-bd hover:bg-accent-bg hover:text-text',
  danger:    'bg-danger-bg text-danger border border-danger-border hover:bg-danger-bg hover:brightness-110',
  success:   'bg-success-bg text-success border border-success-border hover:bg-success-bg hover:brightness-110',
  ghost:     'bg-transparent text-text-2 border border-transparent hover:text-text hover:bg-bg-3',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-[5px] text-xs rounded-[6px]',
  md: 'px-4 py-2 text-[13px] rounded-[8px]',
  lg: 'px-5 py-[10px] text-sm rounded-[8px]',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-[family-name:var(--sans)] font-medium',
        'transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
}
