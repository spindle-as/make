import clsx from 'clsx'
import { Check, Loader2, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react'
import { shortcutFor } from '../lib/shortcuts'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function Kbd({ keys, className }: { keys?: string[]; className?: string }) {
  if (!keys?.length) return null
  return (
    <span className={clsx('inline-flex items-center gap-0.5', className)}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-raised px-1 font-sans text-2xs leading-none text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  shortcut,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  /** shortcut id from the registry, shown as a hint */
  shortcut?: string
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'no-drag inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'lg' && 'h-11 px-5 text-base',
        variant === 'primary' && 'bg-accent text-ink hover:bg-accent-strong',
        variant === 'success' && 'bg-ok text-black hover:brightness-110',
        variant === 'secondary' && 'border border-line-strong bg-raised text-fg hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-fg',
        variant === 'danger' && 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
      {shortcut && <Kbd keys={shortcutFor(shortcut)} className="ml-1 opacity-80" />}
    </button>
  )
}

export function IconButton({
  title,
  shortcut,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; shortcut?: string; active?: boolean }) {
  const keys = shortcut ? shortcutFor(shortcut) : undefined
  const label = keys ? `${title}  ${keys.join('')}` : title
  return (
    <button
      type="button"
      {...rest}
      title={label}
      aria-label={title}
      className={clsx(
        'no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40',
        active && 'bg-hover text-fg',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return (
    <input
      {...rest}
      className={clsx(
        'h-9 w-full rounded-lg border border-line-strong bg-bg/60 px-3 text-sm text-fg placeholder:text-faint outline-none focus:border-accent disabled:opacity-60',
        className
      )}
    />
  )
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...rest}
      className={clsx(
        'w-full resize-none rounded-lg border border-line-strong bg-bg/60 px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-accent',
        className
      )}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={clsx('h-9 rounded-lg border border-line-strong bg-bg/60 px-2.5 text-sm text-fg outline-none focus:border-accent', className)}
    >
      {children}
    </select>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs leading-snug text-faint">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-fg">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </span>
    </label>
  )
}

export function Badge({
  tone = 'neutral',
  children,
  className
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent'
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold tracking-wide uppercase',
        tone === 'neutral' && 'bg-hover text-muted',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'bad' && 'bg-bad/15 text-bad',
        tone === 'info' && 'bg-info/15 text-info',
        tone === 'accent' && 'bg-accent/15 text-accent-strong',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin', className)} />
}

/** Segmented control; ←/→ move between options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const n = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
    onChange(n.value)
  }
  return (
    <div role="radiogroup" onKeyDown={onKey} className={clsx('inline-flex rounded-lg border border-line-strong bg-bg/60 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'no-drag flex items-center gap-1.5 rounded-md font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
            o.value === value ? 'bg-active text-fg shadow-sm' : 'text-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface Option<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  right?: ReactNode
}

/** Keyboard listbox: ↑/↓ to move, Enter/Space to choose. Focus it to drive it. */
export function OptionList<T extends string>({
  options,
  value,
  onSelect,
  autoFocus,
  className
}: {
  options: Option<T>[]
  value: T
  onSelect: (v: T) => void
  autoFocus?: boolean
  className?: string
}) {
  const [active, setActive] = useState(Math.max(0, options.findIndex((o) => o.value === value)))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
  }, [value, options])
  useEffect(() => {
    ref.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, options.length - 1) : Math.max(a - 1, 0)))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      if (options[active]) onSelect(options[active].value)
    }
  }
  return (
    <div ref={ref} role="listbox" tabIndex={0} onKeyDown={onKey} className={clsx('flex flex-col gap-0.5 outline-none', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="option"
          tabIndex={-1}
          data-idx={i}
          aria-selected={o.value === value}
          onMouseEnter={() => setActive(i)}
          onClick={() => onSelect(o.value)}
          className={clsx(
            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
            i === active ? 'bg-hover' : 'hover:bg-hover/60'
          )}
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {o.value === value && <Check className="size-4 text-accent-strong" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-fg">{o.label}</span>
            {o.description && <span className="block text-xs leading-snug text-faint">{o.description}</span>}
          </span>
          {o.right}
        </button>
      ))}
    </div>
  )
}

/** Floating panel anchored to its parent (which must be `relative`). Closes on outside click / Esc. */
export function Popover({
  open,
  onClose,
  children,
  className,
  placement = 'top'
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  placement?: 'top' | 'bottom'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-popover-anchor]')) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      className={clsx(
        'pop-in absolute left-0 z-40 rounded-xl border border-line-strong bg-panel p-2 shadow-2xl',
        placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        className
      )}
    >
      {children}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 600,
  padded = true
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  padded?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the latest onClose without re-running the mount effect (which moves focus).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    // Focus the first field (or the dialog) so keyboard users land inside.
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea, select, [role="listbox"]')
    ;(first ?? ref.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
        )
        if (!items.length) return
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && (i <= 0)) {
          e.preventDefault()
          items[items.length - 1].focus()
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault()
          items[0].focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[7vh] backdrop-blur-[2px]" onMouseDown={() => closeRef.current()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="pop-in flex max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-base font-semibold">{title}</div>
          <IconButton title="Close (Esc)" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto', padded && 'px-5 py-5')}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <div className="text-base font-medium text-fg">{title}</div>
      {children && <div className="max-w-sm text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="text-xs font-semibold tracking-wider text-faint uppercase">{children}</div>
      {right}
    </div>
  )
}

export function timeAgo(ts: number | string): string {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
