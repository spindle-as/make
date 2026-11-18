import clsx from 'clsx'
import { ChevronRight, GitCommitHorizontal, RefreshCw, RotateCcw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseUnifiedDiff, type DiffFile } from '@shared/diff'
import type { Feature, GitStatusInfo } from '@shared/types'
import { Button, Empty, IconButton, Spinner, Textarea } from '../components/ui'
import { act, useStore } from '../store'

function FileDiff({ file, onRevert }: { file: DiffFile; onRevert: () => void }) {
  const [open, setOpen] = useState(file.additions + file.deletions < 400)
  return (
    <div className="border-b border-line">
      <div className="group sticky top-0 z-10 flex items-center gap-2 bg-panel px-3 py-1.5">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
          <span
            className={clsx(
              'w-3 shrink-0 text-2xs font-bold',
              file.status === 'added' && 'text-ok',
              file.status === 'deleted' && 'text-bad',
              file.status === 'modified' && 'text-warn',
              file.status === 'renamed' && 'text-info'
            )}
          >
            {file.status[0].toUpperCase()}
          </span>
          <span className="truncate font-mono text-xs">{file.path}</span>
        </button>
        <span className="font-mono text-xs text-ok">+{file.additions}</span>
        <span className="font-mono text-xs text-bad">−{file.deletions}</span>
        <IconButton title="Revert this file to base" className="size-6 opacity-0 group-hover:opacity-100" onClick={onRevert}>
          <RotateCcw className="size-3.5" />
        </IconButton>
      </div>
      {open && (
        <div className="selectable overflow-x-auto font-mono text-xs leading-[1.55]">
          {file.binary && <div className="px-4 py-2 text-faint">Binary file</div>}
          {file.hunks.map((h, i) => (
            <div key={i}>
              <div className="bg-info/5 px-3 py-0.5 text-xs text-info/80">{h.header}</div>
              {h.lines.map((l, j) => (
                <div
                  key={j}
                  className={clsx(
                    'flex min-w-max',
                    l.kind === 'add' && 'bg-ok/10',
                    l.kind === 'del' && 'bg-bad/10',
                    l.kind === 'meta' && 'text-faint italic'
                  )}
                >
                  <span className="w-10 shrink-0 pr-2 text-right text-faint/70 select-none">{l.oldNo ?? ''}</span>
                  <span className="w-10 shrink-0 pr-2 text-right text-faint/70 select-none">{l.newNo ?? ''}</span>
                  <span
                    className={clsx('w-4 shrink-0 select-none', l.kind === 'add' && 'text-ok', l.kind === 'del' && 'text-bad')}
                  >
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                  </span>
                  <span className="pr-4 whitespace-pre">{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChangesPanel({ feature }: { feature: Feature }) {
  const tick = useStore((s) => s.fsTick[feature.id] ?? 0)
  const [diff, setDiff] = useState('')
  const [status, setStatus] = useState<GitStatusInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<'' | 'suggest' | 'commit' | 'sync'>('')

  const refresh = useCallback(async () => {
    setLoading(true)
    const [d, s] = await Promise.all([
      act(() => window.api.gitDiff(feature.id)),
      act(() => window.api.gitStatus(feature.id))
    ])
    setDiff(d ?? '')
    setStatus(s ?? null)
    setLoading(false)
  }, [feature.id])

  useEffect(() => {
    void refresh()
  }, [refresh, tick])

  useEffect(() => {
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const files = useMemo(() => parseUnifiedDiff(diff), [diff])
  const adds = files.reduce((n, f) => n + f.additions, 0)
  const dels = files.reduce((n, f) => n + f.deletions, 0)

  const suggest = async () => {
    setBusy('suggest')
    const m = await act(() => window.api.suggestCommitMessage(feature.id))
    if (m) setMsg(m)
    setBusy('')
  }

  const commit = async () => {
    setBusy('commit')
    const out = await act(() => window.api.commit(feature.id, msg.trim() || `feat: ${feature.title}`), 'Committed')
    if (out !== undefined) setMsg('')
    setBusy('')
    void refresh()
  }

  const sync = async () => {
    setBusy('sync')
    const out = await act(() => window.api.syncWithBase(feature.id))
    if (out !== undefined) useStore.getState().toast('success', `Synced with ${feature.baseBranch}: ${out.split('\n')[0]}`)
    setBusy('')
    void refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
        <span className="font-medium">{files.length} files</span>
        <span className="font-mono text-ok">+{adds}</span>
        <span className="font-mono text-bad">−{dels}</span>
        {status && (
          <span className="text-faint">
            · {status.commitsAhead.length} commit{status.commitsAhead.length === 1 ? '' : 's'} on branch
            {status.dirty ? ' · uncommitted changes' : ''}
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" loading={busy === 'sync'} onClick={sync} title={`Merge latest ${feature.baseBranch} into this branch`}>
          Sync {feature.baseBranch}
        </Button>
        <IconButton title="Refresh" onClick={refresh}>
          {loading ? <Spinner /> : <RefreshCw className="size-4" />}
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <Empty title={loading ? 'Loading…' : 'No changes yet'}>Changes the agent makes in this worktree show up here.</Empty>
        ) : (
          files.map((f) => (
            <FileDiff
              key={f.path}
              file={f}
              onRevert={async () => {
                if (!confirm(`Revert ${f.path} to ${feature.baseBranch}? This discards its changes.`)) return
                await act(() => window.api.discardFile(feature.id, f.path))
                void refresh()
              }}
            />
          ))
        )}
      </div>

      {status?.dirty && (
        <div className="border-t border-line p-3">
          <Textarea
            rows={2}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={`Commit message (default: feat: ${feature.title})`}
            className="mb-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<Sparkles className="size-4" />} loading={busy === 'suggest'} onClick={suggest}>
              Suggest
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="primary" icon={<GitCommitHorizontal className="size-4" />} loading={busy === 'commit'} onClick={commit}>
              Commit all
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
