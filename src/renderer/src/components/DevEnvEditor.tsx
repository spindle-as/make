import clsx from 'clsx'
import { AlertTriangle, ArrowDown, ArrowUp, Database, FileCode2, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { DbDriver, DbMode, DbService, DevEnvironment, DevEnvView, Project, RuntimeMatch, ServiceDef } from '@shared/types'
import { act, useStore } from '../store'
import { useIsCreator } from '../lib/words'
import { Badge, Button, IconButton, Input, Segmented, Select, Spinner, Textarea, Toggle } from './ui'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DB_LABEL: Record<DbDriver, string> = { mysql: 'MySQL', mariadb: 'MariaDB', pgsql: 'PostgreSQL', sqlite: 'SQLite' }

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      {hint && <p className="mt-0.5 mb-2 text-xs text-faint">{hint}</p>}
      {!hint && <div className="mb-2" />}
      {children}
    </div>
  )
}

/** Ordered list of shell commands (setup steps, quick commands). */
function CommandList({ value, onChange, placeholder, ordered, addLabel }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; ordered?: boolean; addLabel: string }) {
  const move = (i: number, d: number) => {
    const next = [...value]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((cmd, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {ordered && <span className="w-5 shrink-0 text-right font-mono text-xs text-faint">{i + 1}</span>}
          <Input
            value={cmd}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-9 min-w-0 flex-1 font-mono text-xs"
            placeholder={placeholder}
            aria-label={`Command ${i + 1}`}
            spellCheck={false}
          />
          {ordered && (
            <>
              <IconButton title="Move up" className="size-8" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3.5" />
              </IconButton>
              <IconButton title="Move down" className="size-8" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-3.5" />
              </IconButton>
            </>
          )}
          <IconButton title="Remove" className="size-8" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} className="self-start" onClick={() => onChange([...value, ''])}>
        {addLabel}
      </Button>
    </div>
  )
}

export function ServicesEditor({ value, onChange }: { value: ServiceDef[]; onChange: (v: ServiceDef[]) => void }) {
  const update = (i: number, patch: Partial<ServiceDef>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div className="flex flex-col gap-2">
      {value.map((svc, i) => (
        <div key={i} className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2">
          <Input value={svc.name} onChange={(e) => update(i, { name: e.target.value })} className="h-8 max-w-44 shrink-0" aria-label="Process name" />
          <Input value={svc.command} onChange={(e) => update(i, { command: e.target.value })} className="h-8 min-w-0 flex-1 font-mono text-xs" aria-label="Command" spellCheck={false} />
          <Toggle checked={svc.autoStart} onChange={(autoStart) => update(i, { autoStart })} label={<span className="text-sm whitespace-nowrap text-muted">Auto-start</span>} />
          <IconButton title="Remove process" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} className="self-start" onClick={() => onChange([...value, { name: 'New process', command: '', autoStart: true }])}>
        Add process
      </Button>
    </div>
  )
}

function EnvValues({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  // Edited as rows so a half-typed key doesn't collapse into another one.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value))
  const commit = (next: [string, string][]) => {
    setRows(next)
    onChange(Object.fromEntries(next.filter(([k]) => /^[A-Z_][A-Z0-9_]*$/i.test(k.trim())).map(([k, v]) => [k.trim(), v])))
  }
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={k}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value.toUpperCase(), r[1]] : r)))}
            className="h-9 max-w-56 shrink-0 font-mono text-xs"
            placeholder="QUEUE_CONNECTION"
            aria-label="Variable name"
            spellCheck={false}
          />
          <span className="text-faint">=</span>
          <Input value={v} onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} className="h-9 min-w-0 flex-1 font-mono text-xs" placeholder="database" aria-label="Value" spellCheck={false} />
          <IconButton title="Remove" className="size-8" onClick={() => commit(rows.filter((_, j) => j !== i))}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} className="self-start" onClick={() => setRows([...rows, ['', '']])}>
        Add value
      </Button>
    </div>
  )
}

function RuntimePicker({
  label,
  value,
  installed,
  resolved,
  hint,
  major,
  onChange
}: {
  label: string
  value?: string
  installed: RuntimeMatch[]
  resolved?: RuntimeMatch | null
  hint?: string
  major?: boolean
  onChange: (v: string | undefined) => void
}) {
  // PHP is pinned by minor (8.3), Node by major (22) — the way people talk about them.
  const key = (v: string) => v.split('.').slice(0, major ? 1 : 2).join('.')
  const options = [...new Set(installed.map((r) => key(r.version)))]
  if (value && !options.includes(value)) options.unshift(value)
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium">
        {label}
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="mt-1 w-full">
          <option value="">Automatic — whatever is on your PATH</option>
          {options.map((v) => (
            <option key={v} value={v}>
              {label} {v}
              {installed.some((r) => key(r.version) === v) ? '' : ' (not installed)'}
            </option>
          ))}
        </Select>
      </label>
      <span className={clsx('text-xs', value && !resolved ? 'text-warn' : 'text-faint')}>
        {value ? (resolved ? `Uses ${resolved.version} from ${resolved.source}` : `${label} ${value} isn’t installed on this Mac yet`) : hint ? `The project asks for ${hint}` : `${installed.length} version${installed.length === 1 ? '' : 's'} installed`}
      </span>
    </div>
  )
}

function DatabaseSection({ project, value, onChange }: { project: Project; value: DevEnvironment['database']; onChange: (v: DevEnvironment['database']) => void }) {
  const [info, setInfo] = useState<{ driver: DbDriver; database: string; port?: number } | null | undefined>(undefined)
  const [services, setServices] = useState<DbService[]>([])
  useEffect(() => {
    void window.api.projectDbInfo(project.id).then(setInfo)
    void window.api.dbServices().then(setServices)
  }, [project.id])
  const svc = info?.port ? services.find((s) => s.port === info.port && s.kind !== 'redis') : undefined
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-raised/40 px-4 py-3 text-sm">
        <Database className="size-4 text-muted" />
        {info === undefined ? (
          <Spinner />
        ) : info ? (
          <span className="flex-1">
            {DB_LABEL[info.driver]} · <span className="font-mono">{info.database || '—'}</span>
            {info.port && <span className="text-faint"> on port {info.port}</span>}
            {svc && (
              <span className={clsx('ml-2', svc.running ? 'text-ok' : 'text-warn')}>
                DBngin “{svc.name}” {svc.running ? 'running' : 'stopped'}
              </span>
            )}
          </span>
        ) : (
          <span className="flex-1 text-muted">No database configured in .env</span>
        )}
      </div>
      {info && (
        <>
          <Segmented<DbMode>
            value={value.mode}
            onChange={(mode) => onChange({ ...value, mode })}
            options={[
              { value: 'clone', label: 'Copy of main database' },
              { value: 'empty', label: 'Fresh database' },
              { value: 'shared', label: 'Share main database' }
            ]}
          />
          <p className="text-xs text-faint">
            {value.mode === 'clone' && `Each change gets its own ${info.driver === 'sqlite' ? 'SQLite file' : `database (e.g. ${project.slug}_my_change)`} with a copy of your data.`}
            {value.mode === 'empty' && 'Each change gets an empty database that is migrated (and seeded, if you have a DatabaseSeeder).'}
            {value.mode === 'shared' && 'All changes use the same database as the main checkout.'}
            {value.mode !== 'shared' && ' It is dropped automatically when the change is cleaned up.'}
          </p>
          {value.mode !== 'shared' && project.isLaravel && (
            <Toggle checked={value.migrate} onChange={(migrate) => onChange({ ...value, migrate })} label="Run migrations after creating the database" />
          )}
        </>
      )}
    </div>
  )
}

/** Banner for a .spindle file whose commands haven't been approved on this Mac. */
export function TrustBanner({ view, onTrust, action = 'Approve these commands' }: { view: DevEnvView; onTrust: () => void; action?: string }) {
  if (view.trusted) return null
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/10 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Review before Spindle runs these</div>
          <p className="mt-0.5 text-xs text-muted">
            .spindle/config.json came from the repository (or changed since you last approved it). Spindle won’t run its setup steps, auto-start its processes or apply its
            .env values until you approve them.
          </p>
          <ul className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg bg-bg/60 p-2 font-mono text-xs">
            {view.commands.map((c, i) => (
              <li key={i} className="break-all">
                {c}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="primary" className="mt-3" onClick={onTrust}>
            {action}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Editor for a project's .spindle/config.json + instructions.md. Every edit saves (debounced) to
 * the main checkout, so it can be committed and shared; edits made here count as approved.
 */
export function DevEnvEditor({ project, onSaveState, flushRef }: { project: Project; onSaveState: (s: SaveState) => void; flushRef: MutableRefObject<(() => Promise<void>) | null> }) {
  const creator = useIsCreator()
  const [view, setView] = useState<DevEnvView | null>(null)
  const [cfg, setCfg] = useState<DevEnvironment | null>(null)
  const [notes, setNotes] = useState('')
  const [envKey, setEnvKey] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The file version this editor shows; saving over a newer one (a pull, a hand edit) is refused.
  const baseHash = useRef<string | undefined>(undefined)
  const latest = useRef<{ cfg: DevEnvironment | null; notes: string }>({ cfg: null, notes: '' })
  latest.current = { cfg, notes }

  useEffect(() => {
    void act(() => window.api.devEnv(project.id)).then((v) => {
      if (!v) return
      baseHash.current = v.source === 'file' ? v.hash : undefined
      setView(v)
      setCfg(v.config)
      setNotes(v.instructions)
    })
  }, [project.id])

  const persist = async () => {
    timer.current = null
    const cur = latest.current
    if (!cur.cfg) return
    onSaveState('saving')
    try {
      const v = await window.api.saveDevEnv(project.id, cur.cfg, cur.notes, baseHash.current)
      baseHash.current = v.hash
      setView(v)
      onSaveState('saved')
    } catch (e) {
      onSaveState('error')
      useStore.getState().toast('error', (e as Error).message)
    }
  }
  flushRef.current = async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      await persist()
    }
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(), 500)
  }
  const set = <K extends keyof DevEnvironment>(k: K, v: DevEnvironment[K]) => {
    setCfg((c) => (c ? { ...c, [k]: v } : c))
    schedule()
  }

  if (!view || !cfg)
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Reading .spindle…
      </div>
    )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-raised/40 px-4 py-3">
        <FileCode2 className="size-5 shrink-0 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="font-mono">.spindle/config.json</span>
            {view.source === 'file' ? <Badge tone="ok">in your repo</Badge> : <Badge tone="warn">not saved yet</Badge>}
          </div>
          <p className="text-xs text-faint">
            {view.source === 'file'
              ? 'Commit the .spindle folder and everyone on the team gets the same setup. Each change uses its own branch’s copy.'
              : 'Detected from your project. Save it to the repo so the team shares it — any edit below saves it too.'}
          </p>
        </div>
        {view.source === 'file' ? (
          <Button size="sm" variant="ghost" onClick={() => void act(() => window.api.openInEditor(view.file))}>
            Open file
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void persist()}>
            Save to .spindle
          </Button>
        )}
        {!creator && (
          <IconButton
            title="Detect again from the project"
            onClick={async () => {
              if (!confirm('Replace these settings with what Spindle detects from the project? Your instructions are kept.')) return
              const d = await act(() => window.api.detectDevEnv(project.id))
              if (d) {
                setCfg(d)
                setEnvKey((k) => k + 1)
                schedule()
              }
            }}
          >
            <RotateCcw className="size-4" />
          </IconButton>
        )}
      </div>

      {view.parseError && (
        <div className="flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />
          <span>
            {view.parseError}. Spindle uses detected defaults until it’s fixed — fix it in your editor, or edit below to overwrite it.
          </span>
        </div>
      )}

      <TrustBanner
        view={view}
        onTrust={async () => {
          const v = await act(() => window.api.trustDevEnv(project.id), 'Approved — Spindle will run these commands')
          if (v) {
            baseHash.current = v.hash
            setView(v)
          }
        }}
      />

      <Group title="How this project works" hint="Plain-language notes for the AI, given on every turn: test accounts, conventions, where things live, what to avoid. Saved as .spindle/instructions.md.">
        <Textarea
          rows={5}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            schedule()
          }}
          placeholder={'Log in as admin@example.com / password.\nBilling lives in app/Billing — never call Stripe directly, use the BillingService.\nUse Pest for tests.'}
          className="text-sm"
        />
      </Group>

      <Group title="Runtime" hint="Pin versions so every change (and everyone on the team) runs the same PHP and Node. Spindle puts them first on PATH for setup, processes, the site and the AI.">
        <div className="grid grid-cols-2 gap-4">
          <RuntimePicker
            label="PHP"
            value={cfg.runtime.php}
            installed={view.installed.php}
            resolved={view.runtime.php}
            hint={view.hints.phpMin ? `${view.hints.phpMin}+ (installed packages)` : view.hints.php}
            onChange={(php) => set('runtime', { ...cfg.runtime, php })}
          />
          <RuntimePicker
            label="Node"
            major
            value={cfg.runtime.node}
            installed={view.installed.node}
            resolved={view.runtime.node}
            hint={view.hints.node}
            onChange={(node) => set('runtime', { ...cfg.runtime, node })}
          />
        </div>
      </Group>

      {view.warnings.length > 0 && (
        <div className="-mt-3 flex flex-col gap-1">
          {view.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 text-xs text-warn">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <Group title="Background processes" hint="Run for every change while you work — dev server, queue worker, scheduler. Auto-start ones launch when the workspace is ready; the AI can read their logs.">
        <ServicesEditor value={cfg.processes} onChange={(v) => set('processes', v)} />
      </Group>

      {!creator && (
        <Group title="Setup steps" hint="Run in order in every new change’s workspace, after .env and the database are ready. Stops at the first failure. Env: $SF_MAIN_REPO $SF_WORKTREE $SF_BRANCH $SF_URL">
          <CommandList value={cfg.setup} onChange={(v) => set('setup', v)} placeholder="composer install" ordered addLabel="Add step" />
        </Group>
      )}

      <Group title="Database">
        <DatabaseSection project={project} value={cfg.database} onChange={(v) => set('database', v)} />
      </Group>

      <Group title="Email">
        <Toggle
          checked={cfg.mail.capture}
          onChange={(capture) => set('mail', { capture })}
          label="Catch all outgoing email in Spindle"
          hint="Nothing reaches real inboxes; every message shows up in the Email tab."
        />
      </Group>

      {!creator && (
        <>
          <Group title="Website" hint="Leave empty for the usual: public/ for Laravel, served by PHP. For a Node app, give a command that listens on $PORT — Spindle adds HTTPS and the domain in front.">
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Input value={cfg.site.docroot ?? ''} onChange={(e) => set('site', { ...cfg.site, docroot: e.target.value || undefined })} placeholder="public" className="font-mono text-xs" aria-label="Docroot" />
              <Input
                value={cfg.site.command ?? ''}
                onChange={(e) => set('site', { ...cfg.site, command: e.target.value || undefined })}
                placeholder="npm run dev -- --port $PORT (optional)"
                className="font-mono text-xs"
                aria-label="Site command"
                spellCheck={false}
              />
            </div>
          </Group>

          <Group title=".env values for each change" hint="Written into every change’s .env and given to its processes — e.g. QUEUE_CONNECTION=database. Don’t put secrets here: this file is committed.">
            <EnvValues key={envKey} value={cfg.env} onChange={(v) => set('env', v)} />
          </Group>

          <Group title="Quick commands" hint="Shown as one-click buttons in the Terminal tab.">
            <CommandList value={cfg.commands} onChange={(v) => set('commands', v)} placeholder="php artisan test" addLabel="Add command" />
          </Group>
        </>
      )}
    </div>
  )
}

