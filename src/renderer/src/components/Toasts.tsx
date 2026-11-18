import clsx from 'clsx'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useStore } from '../store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex items-start gap-2 rounded-lg border bg-raised px-3 py-2.5 text-sm shadow-xl',
            t.kind === 'error' ? 'border-bad/40' : t.kind === 'success' ? 'border-ok/30' : 'border-line-strong'
          )}
        >
          {t.kind === 'error' ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-info" />
          )}
          <div className="selectable min-w-0 flex-1 leading-snug break-words whitespace-pre-wrap">{t.message}</div>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
