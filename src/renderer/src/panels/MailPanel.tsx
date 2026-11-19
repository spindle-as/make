import clsx from 'clsx'
import { Inbox, Paperclip, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Feature, MailMessage, MailSummary } from '@shared/types'
import { Empty, IconButton, Segmented, timeAgo } from '../components/ui'
import { act, useStore } from '../store'

export function MailPanel({ feature }: { feature: Feature }) {
  const tick = useStore((s) => s.mailTick)
  const [list, setList] = useState<MailSummary[]>([])
  const [sel, setSel] = useState<MailMessage | null>(null)
  const [view, setView] = useState<'html' | 'text' | 'headers'>('html')
  const [port, setPort] = useState(0)
  const selRef = useRef<MailMessage | null>(null)
  selRef.current = sel

  const load = useCallback(async () => {
    const l = await act(() => window.api.mailList(feature.id))
    if (l) setList(l)
    return l
  }, [feature.id])

  useEffect(() => {
    void load().then((l) => {
      // Open the newest message when nothing is selected yet.
      if (l?.length && !selRef.current) void open(l[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, tick])
  useEffect(() => {
    void window.api.mailServerInfo().then((i) => setPort(i.port))
  }, [])

  const open = async (m: MailSummary) => {
    const full = await act(() => window.api.mailGet(m.id))
    if (full) {
      setSel(full)
      setView(full.html ? 'html' : 'text')
      setList((l) => l.map((x) => (x.id === m.id ? { ...x, read: true } : x)))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ShieldCheck className="size-4 text-ok" />
        <span className="text-sm text-muted">Email from this app is caught here and never reaches real people{port ? ` · SMTP 127.0.0.1:${port}` : ''}</span>
        <div className="flex-1" />
        <IconButton title="Refresh" onClick={load}>
          <RefreshCw className="size-4" />
        </IconButton>
        <IconButton
          title="Delete all"
          onClick={async () => {
            await act(() => window.api.mailClear(feature.id))
            setSel(null)
            void load()
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {list.length === 0 ? (
        <Empty icon={<Inbox className="size-8" />} title="No emails yet" />
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul className="w-[42%] shrink-0 overflow-y-auto border-r border-line">
            {list.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => open(m)}
                  className={clsx('block w-full border-b border-line/60 px-3 py-2.5 text-left', sel?.id === m.id ? 'bg-active' : 'hover:bg-raised')}
                >
                  <div className="flex items-center gap-2">
                    {!m.read && <span className="size-2 shrink-0 rounded-full bg-accent" />}
                    <span className={clsx('truncate text-sm', m.read ? 'text-muted' : 'font-semibold text-fg')}>{m.subject}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-faint">
                    <span className="truncate">to {m.to.join(', ')}</span>
                    {m.attachments.length > 0 && <Paperclip className="size-3 shrink-0" />}
                    <span className="ml-auto shrink-0">{timeAgo(m.date)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col">
            {sel ? (
              <>
                <div className="border-b border-line px-4 py-3">
                  <div className="text-base font-semibold">{sel.subject}</div>
                  <div className="mt-0.5 text-sm text-muted">From {sel.from}</div>
                  <div className="text-sm text-muted">To {sel.to.join(', ')}</div>
                  {sel.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sel.attachments.map((a, i) => (
                        <span key={i} className="flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-xs text-muted">
                          <Paperclip className="size-3" /> {a.filename} · {Math.ceil(a.size / 1024)} KB
                        </span>
                      ))}
                    </div>
                  )}
                  <Segmented
                    size="sm"
                    className="mt-3"
                    value={view}
                    onChange={setView}
                    options={[
                      ...(sel.html ? [{ value: 'html' as const, label: 'Preview' }] : []),
                      { value: 'text' as const, label: 'Plain text' },
                      { value: 'headers' as const, label: 'Headers' }
                    ]}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {view === 'html' && sel.html ? (
                    // Sandboxed: no scripts, no navigation, no access to the app.
                    <iframe title="Email preview" sandbox="" srcDoc={sel.html} className="h-full w-full bg-white" />
                  ) : view === 'headers' ? (
                    <table className="selectable w-full text-xs">
                      <tbody>
                        {sel.headers.map(([k, v], i) => (
                          <tr key={i} className="border-b border-line/50 align-top">
                            <td className="w-40 px-3 py-1.5 font-mono text-faint">{k}</td>
                            <td className="px-3 py-1.5 font-mono break-all text-muted">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <pre className="selectable p-4 font-mono text-sm whitespace-pre-wrap text-fg/90">{sel.text ?? '(no plain-text version)'}</pre>
                  )}
                </div>
              </>
            ) : (
              <Empty title="Select an email" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
