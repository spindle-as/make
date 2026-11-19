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
        // Material 3 common buttons: pill shaped, 40px tall (36px small), label-large text.
        'press no-drag inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'h-9 px-4 text-sm',
        size === 'md' && 'h-10 px-5 text-sm',
        size === 'lg' && 'h-12 px-6 text-base',
        variant === 'primary' && 'bg-accent text-ink hover:bg-accent-strong',
        variant === 'success' && 'bg-ok text-ink hover:brightness-110',
        variant === 'secondary' && 'bg-hover text-fg hover:bg-active',
        variant === 'ghost' && 'px-3 text-fg/90 hover:bg-hover hover:text-fg',
        variant === 'danger' && 'border border-bad/50 text-bad hover:bg-bad/10',
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
        // Material 3 standard icon button: 40px round target.
        'press no-drag inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg disabled:opacity-40',
        active && 'bg-active text-fg',
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
        'h-10 w-full rounded-xl border border-line-strong bg-bg/60 px-3 text-sm text-fg placeholder:text-faint outline-none transition-[border-color,box-shadow] focus:border-info/60 focus:ring-3 focus:ring-info/15 disabled:opacity-60',
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
        'w-full resize-none rounded-xl border border-line-strong bg-bg/60 px-3 py-2 text-sm text-fg placeholder:text-faint outline-none transition-[border-color,box-shadow] focus:border-info/60 focus:ring-3 focus:ring-info/15',
        className
      )}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={clsx('h-10 rounded-xl border border-line-strong bg-bg/60 px-2.5 text-sm text-fg outline-none transition-[border-color,box-shadow] focus:border-info/60 focus:ring-3 focus:ring-info/15', className)}
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
    <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-8 w-[52px] shrink-0 rounded-full border-2 transition-colors', checked ? 'border-accent bg-accent' : 'border-muted/70 bg-hover')}
      >
        <span
          className={clsx(
            'absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full transition-all',
            checked ? 'left-[22px] size-6 bg-ink text-fg' : 'left-[6px] size-4 bg-muted'
          )}
        >
          {checked && <Check className="size-3.5" strokeWidth={3} />}
        </span>
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
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-hover text-muted',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'bad' && 'bg-bad/15 text-bad',
        tone === 'info' && 'bg-info/15 text-info',
        tone === 'accent' && 'bg-active text-fg',
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
    <div role="radiogroup" onKeyDown={onKey} className={clsx('inline-flex overflow-hidden rounded-full border border-line-strong', className)}>
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
            'no-drag flex items-center justify-center gap-1.5 border-line-strong font-medium transition-colors [&:not(:first-child)]:border-l',
            size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
            o.value === value ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
          )}
        >
          {/* M3: the selected segment shows a check — unless the label already carries its own icon */}
          {o.value === value && typeof o.label === 'string' && <Check className="size-3.5 shrink-0" strokeWidth={2.5} />}
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
    <div ref={ref} role="listbox" tabIndex={0} onKeyDown={onKey} aria-activedescendant={undefined} className={clsx('flex flex-col gap-0.5 outline-none focus-visible:outline-none [&:focus-visible_[data-idx]:hover]:bg-hover', className)}>
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
            'flex min-h-11 w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
            i === active ? 'bg-hover' : 'hover:bg-hover/60'
          )}
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {o.value === value && <Check className="size-4 text-fg" />}
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
        'menu-in absolute left-0 z-40 rounded-2xl border border-line bg-raised p-2 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.5)]',
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
        className="menu-in flex max-h-[86vh] flex-col overflow-hidden rounded-[28px] border border-line bg-panel shadow-2xl focus-visible:outline-none"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <IconButton title="Close (Esc)" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto', padded && 'px-6 pt-1 pb-5')}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-6 pt-2 pb-5">{footer}</div>}
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
      <h3 className="text-sm font-semibold text-muted">{children}</h3>
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

export interface MenuEntry {
  key: string
  label: ReactNode
  icon?: ReactNode
  description?: ReactNode
  /** e.g. a count badge or shortcut */
  trailing?: ReactNode
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/**
 * Material 3 menu: a list of choices on a temporary surface. ↑/↓/Home/End move, Enter/Space choose,
 * Esc or Tab closes and focus returns to the button that opened it.
 */
export function Menu({
  items,
  label,
  renderTrigger,
  placement = 'bottom',
  align = 'left',
  width = 280,
  header
}: {
  items: (MenuEntry | 'divider')[]
  /** accessible name of the menu */
  label: string
  renderTrigger: (p: {
    open: boolean
    toggle: () => void
    /** spread onto the trigger button */
    props: { ref: (el: HTMLButtonElement | null) => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'data-popover-anchor': true }
  }) => ReactNode
  placement?: 'top' | 'bottom'
  align?: 'left' | 'right'
  width?: number
  header?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const onKey = (e: ReactKeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])]
    const i = els.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      els[(n + els.length) % els.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(els.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close(false)
  }
  return (
    <div className="relative">
      {renderTrigger({
        open,
        toggle: () => setOpen((o) => !o),
        props: {
          ref: (el) => {
            trigger.current = el
          },
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'data-popover-anchor': true
        }
      })}
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          style={{ width }}
          className={clsx(
            'menu-in absolute z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-raised py-2 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.5)]',
            placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {header}
          {items.map((it, i) =>
            it === 'divider' ? (
              <div key={`d${i}`} role="separator" className="my-2 h-px bg-line" />
            ) : (
              <button
                key={it.key}
                type="button"
                role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={it.checked}
                disabled={it.disabled}
                onClick={() => {
                  close()
                  it.onSelect()
                }}
                className={clsx(
                  'flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover disabled:opacity-40',
                  it.danger ? 'text-bad' : 'text-fg'
                )}
              >
                {it.icon !== undefined && <span className={clsx('flex size-5 shrink-0 items-center justify-center', it.danger ? 'text-bad' : 'text-muted')}>{it.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.label}</span>
                  {it.description && <span className="block text-xs leading-snug text-muted">{it.description}</span>}
                </span>
                {it.trailing}
                {it.checked && <Check className="size-4 shrink-0" />}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Drag handle on the edge of a resizable pane. Drag it, use ←/→ when it has focus (Shift for big
 * steps), or double-click to go back to the default width.
 */
export function ResizeHandle({
  edge,
  value,
  min,
  max,
  fallback,
  onChange,
  label
}: {
  /** which edge of the pane the handle sits on */
  edge: 'left' | 'right'
  value: number
  min: number
  max: number
  /** width a double-click returns to */
  fallback: number
  onChange: (width: number) => void
  label: string
}) {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — drag, or double-click to reset`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: value }
        setDragging(true)
        document.body.style.cursor = 'col-resize'
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        const dx = e.clientX - start.current.x
        onChange(clamp(start.current.w + (edge === 'right' ? dx : -dx)))
      }}
      onPointerUp={() => {
        setDragging(false)
        document.body.style.cursor = ''
        document.body.classList.remove('resizing')
      }}
      onDoubleClick={() => onChange(clamp(fallback))}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowRight' ? 1 : -1) * (edge === 'right' ? 1 : -1)
        onChange(clamp(value + step))
      }}
      className={clsx('group no-drag absolute top-0 z-30 flex h-full w-3 cursor-col-resize justify-center outline-none', edge === 'right' ? '-right-1.5' : '-left-1.5')}
    >
      <span className={clsx('h-full w-0.5 rounded-full transition-colors', dragging ? 'bg-focus' : 'bg-transparent group-hover:bg-line-strong group-focus-visible:bg-focus')} />
    </div>
  )
}
