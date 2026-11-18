import clsx from 'clsx'
import { Check, ChevronRight, Globe, Link2, Rocket, Search, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgentKind, Environment, PloiSiteRef, Project } from '@shared/types'
import { act, useStore } from '../store'
import { Badge, Button, Field, IconButton, Input, Modal, SectionTitle, Segmented, Spinner, Toggle } from './ui'
import { DevEnvEditor, type SaveState } from './DevEnvEditor'

function EnvRow({ env, onChange, onRemove }: { env: Environment; onChange: (e: Environment) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const set = <K extends keyof Environment>(k: K, v: Environment[K]) => onChange({ ...env, [k]: v })
  return (
    <div className="rounded-xl border border-line bg-raised/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={clsx('size-4 text-faint transition-transform', open && 'rotate-90')} />
          <Rocket className="size-4 text-muted" />
          <span className="text-base font-medium capitalize">{env.name}</span>
          <span className="truncate text-sm text-muted">{env.url?.replace(/^https?:\/\//, '')}</span>
          <span className="font-mono text-xs text-faint">← {env.branch}</span>
        </button>
        <Toggle checked={!!env.autoDeployOnMerge} onChange={(v) => set('autoDeployOnMerge', v)} label={<span className="text-sm text-muted">Auto-deploy on merge</span>} />
        <IconButton title="Remove environment" onClick={onRemove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-4">
          <Field label="Name">
            <Input value={env.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Deploys branch">
            <Input value={env.branch} onChange={(e) => set('branch', e.target.value)} className="font-mono" />
          </Field>
          <Field label="Public URL">
            <Input value={env.url ?? ''} onChange={(e) => set('url', e.target.value || undefined)} />
          </Field>
          <Field label="Nightwatch dashboard URL" hint="Embedded in the Logs tab">
            <Input value={env.nightwatchUrl ?? ''} onChange={(e) => set('nightwatchUrl', e.target.value || undefined)} placeholder="https://nightwatch.laravel.com/…" />
          </Field>
          <Field label="SSH target (remote logs)" hint="Uses your SSH keys">
            <Input value={env.sshTarget ?? ''} onChange={(e) => set('sshTarget', e.target.value || undefined)} placeholder="ploi@1.2.3.4" />
          </Field>
          <Field label="Site path on the server">
            <Input value={env.remotePath ?? ''} onChange={(e) => set('remotePath', e.target.value || undefined)} />
          </Field>
        </div>
      )}
    </div>
  )
}

function PloiLinker({ project, onLink }: { project: Project; onLink: (ref: PloiSiteRef) => void }) {
  const hasToken = useStore((s) => s.settings?.hasPloiToken)
  const openModal = useStore((s) => s.openModal)
  const [sites, setSites] = useState<PloiSiteRef[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!hasToken) return
    window.api
      .suggestPloiSites(project.id)
      .then(setSites)
      .catch((e) => setError((e as Error).message))
  }, [hasToken, project.id])

  if (!hasToken) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
        <Rocket className="size-5 text-accent-strong" />
        <span className="flex-1">Connect Ploi to deploy this project with one click.</span>
        <Button size="sm" variant="primary" onClick={() => openModal({ kind: 'settings', tab: 'integrations' })}>
          Connect Ploi
        </Button>
      </div>
    )
  }
  if (error) return <div className="text-sm text-bad">{error}</div>
  if (!sites)
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading your Ploi sites…
      </div>
    )
  const linked = new Set(project.environments.map((e) => e.ploiSiteId))
  const available = sites.filter((s) => !linked.has(s.siteId))
  const filtered = q ? available.filter((s) => `${s.domain} ${s.serverName}`.toLowerCase().includes(q.toLowerCase())) : available.slice(0, 8)
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Link a Ploi site — ${available.length} available`}
          aria-label="Search Ploi sites"
          className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>
      <ul className="max-h-56 overflow-y-auto p-1">
        {filtered.map((s) => (
          <li key={s.siteId}>
            <button type="button" onClick={() => onLink(s)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-hover">
              <Globe className="size-4 text-faint" />
              <span className="min-w-0 flex-1 truncate text-sm">{s.domain}</span>
              {(s.score ?? 0) >= 10 && (
                <Badge tone="accent">
                  <Sparkles className="size-3" /> match
                </Badge>
              )}
              <span className="text-xs text-faint">{s.serverName}</span>
              <Link2 className="size-4 text-muted" />
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="px-3 py-3 text-sm text-faint">No sites match.</li>}
      </ul>
    </div>
  )
}

type Tab = 'general' | 'environment' | 'deploy'

export function ProjectDialog({ projectId, onClose, tab: initialTab }: { projectId: string; onClose: () => void; tab?: Tab }) {
  const stored = useStore((s) => s.projects.find((p) => p.id === projectId))
  const upsert = useStore((s) => s.upsertProject)
  const removeLocal = useStore((s) => s.removeProject)
  const [p, setP] = useState<Project | undefined>(stored)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const envFlush = useRef<(() => Promise<void>) | null>(null)
  const latest = useRef<{ p?: Project }>({ p })
  latest.current = { p }

  // Every change saves itself (debounced) — no Save button to forget, and linking a
  // Ploi site or toggling auto-deploy can never leave other edits unsaved.
  const persist = async () => {
    const cur = latest.current
    if (!cur.p) return
    setSaveState('saving')
    try {
      // The environment lives in .spindle/ (saved by its own editor); never overwrite its cached copies from here.
      const { services: _s, quickCommands: _q, database: _d, captureMail: _c, trustedEnvHashes: _t, ...rest } = cur.p
      const next = await window.api.updateProject(cur.p.id, rest)
      upsert(next)
      setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      useStore.getState().toast('error', (e as Error).message)
    }
  }
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(), 400)
  }
  const flushAndClose = async () => {
    await envFlush.current?.()
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      await persist()
    }
    onClose()
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // Pick up environments linked automatically in the background.
  useEffect(() => {
    if (stored && p && stored.environments.length !== p.environments.length) setP({ ...p, environments: stored.environments })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.environments.length])

  if (!p) return null
  const set = <K extends keyof Project>(k: K, v: Project[K]) => {
    setP({ ...p, [k]: v })
    schedule()
  }

  const link = async (ref: PloiSiteRef) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      await persist()
    }
    const next = await act(() => window.api.linkPloiSite(p.id, ref), `Linked ${ref.domain}`)
    if (next) {
      upsert(next)
      setP(next)
      setSaveState('saved')
    }
  }

  const remove = async () => {
    if (!confirm(`Remove ${p.name} from Software Factory? Worktrees and branches stay on disk.`)) return
    if (timer.current) clearTimeout(timer.current)
    await act(() => window.api.removeProject(p.id))
    removeLocal(p.id)
    onClose()
  }

  return (
    <Modal
      title={p.name}
      onClose={() => void flushAndClose()}
      width={820}
      footer={
        <>
          <Button variant="danger" className="mr-auto" onClick={remove}>
            Remove project
          </Button>
          <span className="flex items-center gap-1.5 text-sm text-faint" aria-live="polite">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && (
              <>
                <Check className="size-4 text-ok" /> Saved
              </>
            )}
            {saveState === 'error' && <span className="text-bad">Couldn’t save</span>}
            {saveState === 'idle' && 'Changes save automatically'}
          </span>
          <Button variant="primary" onClick={() => void flushAndClose()}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'general', label: 'General' },
            { value: 'environment', label: 'Environment' },
            { value: 'deploy', label: 'Deploy' }
          ]}
        />

        {tab === 'general' && (
          <section>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <Input value={p.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="GitHub repo" hint={p.githubRepo ? 'Detected from the git remote' : 'owner/name — needed for PRs and CI'}>
                <Input value={p.githubRepo ?? ''} onChange={(e) => set('githubRepo', e.target.value || undefined)} placeholder="owner/name" />
              </Field>
              <Field label="Main branch">
                <Input value={p.defaultBranch} onChange={(e) => set('defaultBranch', e.target.value)} className="font-mono" />
              </Field>
              <Field label="Default agent">
                <Segmented<AgentKind>
                  value={p.defaultAgent}
                  onChange={(v) => set('defaultAgent', v)}
                  options={[
                    { value: 'claude', label: 'Claude Code' },
                    { value: 'codex', label: 'Codex' }
                  ]}
                />
              </Field>
            </div>
          </section>
        )}

        {tab === 'environment' && (
          <>
            <section>
              <SectionTitle>Local website</SectionTitle>
              <Segmented<'spindle' | 'herd'>
                value={p.server ?? (p.herdEnabled ? 'herd' : 'spindle')}
                onChange={(v) => {
                  setP({ ...p, server: v, herdEnabled: v === 'herd' })
                  schedule()
                }}
                options={[
                  { value: 'spindle', label: 'Spindle (built-in HTTPS)' },
                  { value: 'herd', label: 'Laravel Herd' }
                ]}
              />
              <p className="mt-1.5 text-xs text-faint">
                {(p.server ?? (p.herdEnabled ? 'herd' : 'spindle')) === 'spindle'
                  ? `Each change gets https://my-change.${p.slug}.localhost — no extra software, works offline.`
                  : `Each change gets https://${p.slug}-my-change.test through Herd.`}{' '}
                This choice is personal to this Mac; everything below is shared through the repo.
              </p>
              {p.herdEnabled && (
                <div className="mt-3">
                  <Toggle checked={p.herdSecure} onChange={(v) => set('herdSecure', v)} label="Served over HTTPS (herd secure)" />
                </div>
              )}
            </section>
            <section>
              <SectionTitle>Development environment</SectionTitle>
              <DevEnvEditor project={p} onSaveState={setSaveState} flushRef={envFlush} />
            </section>
          </>
        )}

        {tab === 'deploy' && (
          <section>
            <div className="flex flex-col gap-3">
              {p.environments.map((env, i) => (
                <EnvRow
                  key={env.id}
                  env={env}
                  onChange={(e) => set('environments', p.environments.map((x, j) => (j === i ? e : x)))}
                  onRemove={() => set('environments', p.environments.filter((_, j) => j !== i))}
                />
              ))}
              <PloiLinker project={p} onLink={link} />
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
