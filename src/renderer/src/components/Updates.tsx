import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UpdateState } from '@shared/types'
import { act, useStore } from '../store'
import { Button, Modal, Spinner, timeAgo } from './ui'

const mb = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(0)} MB` : '')

/** Small notice above the settings button when a new version is out (or ready to install). */
export function UpdateNotice() {
  const u = useStore((s) => s.update)
  const openModal = useStore((s) => s.openModal)
  if (!u || !['available', 'downloading', 'ready'].includes(u.status)) return null
  return (
    <button
      type="button"
      onClick={() => openModal({ kind: 'update' })}
      className="flex h-10 w-full items-center gap-2.5 rounded-lg bg-info/12 px-3 text-sm font-medium text-info hover:bg-info/20"
    >
      {u.status === 'downloading' ? <Spinner /> : <ArrowUpCircle className="size-4" />}
      <span className="flex-1 text-left">
        {u.status === 'ready' ? `Restart to update to ${u.latest}` : u.status === 'downloading' ? `Downloading ${u.latest}… ${Math.round((u.progress ?? 0) * 100)}%` : `Update to ${u.latest} available`}
      </span>
    </button>
  )
}

function Status({ u }: { u: UpdateState }) {
  switch (u.status) {
    case 'checking':
      return (
        <span className="flex items-center gap-2 text-muted">
          <Spinner /> Checking GitHub for a new version…
        </span>
      )
    case 'none':
      return (
        <span className="flex items-center gap-2 text-ok">
          <CheckCircle2 className="size-4" /> You have the latest version ({u.current}).
        </span>
      )
    case 'available':
      return (
        <span className="text-fg">
          Version <b>{u.latest}</b> is available — you have {u.current}.{u.size ? ` Download: ${mb(u.size)}.` : ''}
        </span>
      )
    case 'downloading':
      return (
        <div className="flex flex-col gap-2">
          <span className="text-muted">Downloading {u.latest}…</span>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((u.progress ?? 0) * 100)}%` }} />
          </div>
        </div>
      )
    case 'ready':
      return <span className="text-fg">Version {u.latest} is downloaded and verified. Restart to switch — takes a few seconds.</span>
    case 'error':
      return <span className="text-bad">{u.error}</span>
    default:
      return <span className="text-muted">Version {u.current}</span>
  }
}

export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const u = useStore((s) => s.update)
  const statuses = useStore((s) => s.statuses)
  if (!u) return null
  const working = Object.values(statuses).filter((s) => s.running).length

  const restart = async () => {
    if (working && !confirm(`${working} agent${working > 1 ? 's are' : ' is'} still working. Restarting stops ${working > 1 ? 'them' : 'it'} — the conversation is kept. Restart now?`)) return
    await act(() => window.api.installUpdate())
  }

  return (
    <Modal
      title="Updates"
      onClose={onClose}
      width={620}
      footer={
        <>
          {u.url && (
            <Button variant="ghost" className="mr-auto" icon={<ExternalLink className="size-4" />} onClick={() => void window.api.openExternal(u.url!)}>
              Release on GitHub
            </Button>
          )}
          {(u.status === 'none' || u.status === 'error' || u.status === 'idle') && (
            <Button icon={<RefreshCw className="size-4" />} onClick={() => void act(() => window.api.checkForUpdates())}>
              Check again
            </Button>
          )}
          {u.status === 'available' &&
            (u.canInstall ? (
              <Button variant="primary" icon={<Download className="size-4" />} onClick={() => void act(() => window.api.downloadUpdate())}>
                Download update
              </Button>
            ) : (
              <span className="text-sm text-faint">Development build — updates install into the packaged app.</span>
            ))}
          {u.status === 'ready' && (
            <Button variant="primary" icon={<RotateCw className="size-4" />} onClick={() => void restart()}>
              Restart now
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="text-sm">
          <Status u={u} />
          {u.checkedAt && u.status !== 'checking' && <div className="mt-1 text-xs text-faint">Checked {timeAgo(u.checkedAt)}</div>}
        </div>
        {u.latest && u.notes && u.status !== 'none' && (
          <div>
            <div className="mb-2 text-sm font-medium">
              What’s new in {u.latest}
              {u.publishedAt && <span className="ml-2 font-normal text-faint">{timeAgo(u.publishedAt)}</span>}
            </div>
            <div className="prose-chat max-h-72 overflow-y-auto rounded-xl border border-line bg-raised/40 px-4 py-3 text-sm">
              <Markdown remarkPlugins={[remarkGfm]}>{u.notes}</Markdown>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
