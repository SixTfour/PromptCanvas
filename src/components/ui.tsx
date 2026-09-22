import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap'
  const sizes = { sm: 'text-xs px-2 py-1', md: 'text-[13px] px-3 py-1.5' }
  const variants = {
    default: 'bg-[var(--color-edge)] text-[var(--color-ink)] hover:bg-[#2c3342]',
    primary: 'bg-[var(--color-accent)] text-[#0b0d12] hover:bg-[#93a0ff]',
    ghost: 'text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-edge)]',
    danger: 'bg-transparent text-[var(--color-danger)] hover:bg-[#3a1f22]',
  }
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5 font-medium">
      {children}
    </div>
  )
}

export function Field({
  value,
  onChange,
  placeholder,
  rows = 3,
  mono = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  mono?: boolean
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full resize-y rounded-md bg-[var(--color-canvas)] border border-[var(--color-edge)] px-2.5 py-2 text-[13px] leading-relaxed text-[var(--color-ink)] placeholder:text-[#5a6175] focus:outline-none focus:border-[var(--color-accent)] ${
        mono ? 'font-mono text-xs' : ''
      }`}
    />
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono = false,
  onKeyDown,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={`w-full rounded-md bg-[var(--color-canvas)] border border-[var(--color-edge)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] placeholder:text-[#5a6175] focus:outline-none focus:border-[var(--color-accent)] ${
        mono ? 'font-mono text-xs' : ''
      }`}
    />
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-md bg-[var(--color-canvas)] border border-[var(--color-edge)] px-2 py-1.5 text-[13px] text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'good' | 'danger'
}) {
  const tones = {
    neutral: 'bg-[var(--color-edge)] text-[var(--color-muted)]',
    accent: 'bg-[#232a4d] text-[var(--color-accent)]',
    warn: 'bg-[#3a3218] text-[var(--color-warn)]',
    good: 'bg-[#16332a] text-[var(--color-good)]',
    danger: 'bg-[#3a1f22] text-[var(--color-danger)]',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] shadow-2xl my-8`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-edge)] px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

/** A small two-or-three-way switch, for view modes rather than data. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div className="flex overflow-hidden rounded border border-[var(--color-edge)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[12px] ${
            value === o.value
              ? 'bg-[var(--color-accent)] text-[#0b0d12]'
              : 'text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
