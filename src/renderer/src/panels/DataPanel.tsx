import clsx from 'clsx'
import { Camera, ChevronLeft, ChevronRight, Database, History, Play, RefreshCw, RotateCcw, Sprout, Table2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DbSnapshot, DbTable, Feature, QueryResult } from '@shared/types'
import { Badge, Button, Empty, IconButton, Spinner, Textarea, Toggle, timeAgo } from '../components/ui'
import { act, useStore } from '../store'
import { useIsCreator } from '../lib/words'

function Grid({ result }: { result: QueryResult }) {
  if (!result.columns.length) return <div className="p-4 text-sm text-muted">Done{result.affected ? ` · ${result.affected}` : ''}.</div>
  return (
    <div className="selectable min-h-0 flex-1 overflow-auto">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-panel">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="border-b border-line px-3 py-2 text-left font-mono font-semibold text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={result.columns.length} className="px-3 py-6 text-center text-sm text-faint">
                No rows yet.
              </td>
            </tr>
          )}
          {result.rows.map((r, i) => (
            <tr key={i} className="hover:bg-raised">
              {r.map((v, j) => (
                <td key={j} className="max-w-[320px] truncate border-b border-line/50 px-3 py-1.5 font-mono" title={v ?? 'NULL'}>
                  {v === null ? <span className="text-faint italic">null</span> : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && <div className="p-2 text-xs text-faint">Showing the first 500 rows.</div>}
    </div>
  )
}

export function DataPanel({ feature }: { feature: Feature }) {
  const creator = useIsCreator()
  const tick = useStore((s) => s.fsTick[feature.id] ?? 0)
  const [info, setInfo] = useState<{ driver: string; database: string; tables: DbTable[]; editable: boolean } | null>(null)
  const [error, setError] = useState('')
  const [table, setTable] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [mode, setMode] = useState<'browse' | 'query' | 'snapshots'>('browse')
  const [sql, setSql] = useState('')
  const [allowWrite, setAllowWrite] = useState(false)
  const [busy, setBusy] = useState('')
  const [snaps, setSnaps] = useState<DbSnapshot[]>([])

  const load = useCallback(async () => {
    try {
      setError('')
      setInfo(await window.api.dbTables(feature.id))
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }, [feature.id])

  useEffect(() => {
    void load()
  }, [load, tick])

  useEffect(() => {
    if (!table || mode !== 'browse') return
    void act(() => window.api.dbRows(feature.id, table, page)).then((r) => r && setResult(r))
  }, [table, page, mode, feature.id, tick])

  const loadSnaps = useCallback(async () => setSnaps((await act(() => window.api.dbSnapshots(feature.id))) ?? []), [feature.id])
  useEffect(() => {
    if (mode === 'snapshots') void loadSnaps()
  }, [mode, loadSnaps])

  const run = async () => {
    setBusy('query')
    const r = await act(() => window.api.dbQuery(feature.id, sql, allowWrite))
    if (r) setResult(r)
    setBusy('')
  }

  if (error)
    return (
      <Empty icon={<Database className="size-8" />} title="No database to show">
        {error}
      </Empty>
    )
  if (!info)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Database className="size-4 text-muted" />
        <span className="truncate font-mono text-xs text-muted" title={info.database}>
          {info.driver} · {info.database.split('/').slice(-2).join('/')}
        </span>
        {info.editable ? <Badge tone="ok">this change’s own copy</Badge> : <Badge tone="warn">shared · read-only</Badge>}
        <div className="flex-1" />
        <div className="flex rounded-lg border border-line-strong p-0.5">
          {(['browse', ...(creator ? [] : ['query']), 'snapshots'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m as typeof mode)}
              className={clsx('h-7 rounded-md px-2.5 text-xs font-medium', mode === m ? 'bg-active text-fg' : 'text-muted hover:text-fg')}
            >
              {m === 'browse' ? 'Browse' : m === 'query' ? 'Query' : 'Snapshots'}
            </button>
          ))}
        </div>
        <IconButton title="Refresh" onClick={load}>
          <RefreshCw className="size-4" />
        </IconButton>
      </div>

      {mode === 'browse' && (
        <div className="flex min-h-0 flex-1">
          <ul className="w-48 shrink-0 overflow-y-auto border-r border-line py-1">
            {info.tables.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => {
                    setTable(t.name)
                    setPage(0)
                  }}
                  className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', table === t.name ? 'bg-active text-fg' : 'text-muted hover:bg-raised hover:text-fg')}
                >
                  <Table2 className="size-3.5 shrink-0" />
                  <span className="truncate">{t.name}</span>
                  {t.rows !== undefined && <span className="ml-auto text-2xs text-faint">{t.rows}</span>}
                </button>
              </li>
            ))}
            {info.tables.length === 0 && <li className="px-3 py-2 text-sm text-faint">No tables yet.</li>}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col">
            {table && result ? (
              <>
                <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-muted">
                  <span className="font-medium text-fg">{table}</span>
                  <span>{result.rows.length ? `rows ${page * 100 + 1}–${page * 100 + result.rows.length}` : 'empty'}</span>
                  <div className="flex-1" />
                  <IconButton title="Previous page" className="size-7" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="size-4" />
                  </IconButton>
                  <IconButton title="Next page" className="size-7" disabled={result.rows.length < 100} onClick={() => setPage(page + 1)}>
                    <ChevronRight className="size-4" />
                  </IconButton>
                </div>
                <Grid result={result} />
              </>
            ) : (
              <Empty icon={<Table2 className="size-7" />} title="Pick a table" />
            )}
          </div>
        </div>
      )}

      {mode === 'query' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line p-3">
            <Textarea
              rows={4}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) void run()
              }}
              placeholder="SELECT * FROM users WHERE email LIKE '%@example.com' — ⌘↵ to run"
              className="font-mono text-xs"
              spellCheck={false}
            />
            <div className="mt-2 flex items-center gap-3">
              <Toggle checked={allowWrite} onChange={setAllowWrite} label={<span className="text-sm text-muted">Allow changes</span>} />
              {allowWrite && !info.editable && <span className="text-xs text-warn">Only possible in a change’s own database</span>}
              <div className="flex-1" />
              {result && <span className="text-xs text-faint">{result.ms} ms</span>}
              <Button variant="primary" size="sm" icon={<Play className="size-3.5" />} loading={busy === 'query'} onClick={run} disabled={!sql.trim()}>
                Run
              </Button>
            </div>
          </div>
          {result ? <Grid result={result} /> : <Empty title="Run a query" />}
        </div>
      )}

      {mode === 'snapshots' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <p className="text-sm text-muted">Save the current data so you can go back to it after testing — or start over with fresh sample data.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Camera className="size-4" />}
              loading={busy === 'snap'}
              onClick={async () => {
                setBusy('snap')
                await act(() => window.api.dbSnapshot(feature.id, `Snapshot ${new Date().toLocaleString()}`), 'Snapshot saved')
                setBusy('')
                void loadSnaps()
              }}
            >
              Save a snapshot
            </Button>
            {info.editable && (
              <Button
                icon={<Sprout className="size-4" />}
                loading={busy === 'reset'}
                onClick={async () => {
                  if (!confirm('Replace all data in this change’s database with fresh sample data?')) return
                  setBusy('reset')
                  await act(() => window.api.dbReset(feature.id), 'Fresh sample data loaded')
                  setBusy('')
                  void load()
                }}
              >
                Start over with sample data
              </Button>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {snaps.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2.5">
                <History className="size-4 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.label}</span>
                  <span className="text-xs text-faint">
                    {timeAgo(s.at)} · {(s.size / 1024).toFixed(0)} KB
                  </span>
                </span>
                {info.editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw className="size-3.5" />}
                    onClick={async () => {
                      if (!confirm(`Restore “${s.label}”? The current data in this change’s database is replaced.`)) return
                      await act(() => window.api.dbRestore(feature.id, s.id), 'Restored')
                      void load()
                    }}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
            {snaps.length === 0 && <li className="text-sm text-faint">No snapshots yet.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
