import clsx from 'clsx'
import { Check, CircleDashed, FolderOpen, GitFork, GitPullRequest as Github, Lock, Plus, RotateCw, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GithubRepoRef, Project } from '@shared/types'
import { addProject } from '../lib/actions'
import { act, useStore } from '../store'
import { Badge, Button, Input, Modal, Segmented, Spinner, timeAgo } from './ui'

const ROLE_LABEL: Record<string, { label: string; tone: 'ok' | 'info' | 'neutral' | 'warn' }> = {
  maintainer: { label: 'Maintainer', tone: 'ok' },
  developer: { label: 'Can push', tone: 'info' },
  contributor: { label: 'Contributor', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'warn' }
}

export function RoleBadge({ role }: { role?: string }) {
  const r = ROLE_LABEL[role ?? 'unknown'] ?? ROLE_LABEL.unknown
  return <Badge tone={r.tone}>{r.label}</Badge>
}

type Source = 'github' | 'local' | 'new'

export function OpenProjectDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<Source>('github')
  const [repos, setRepos] = useState<GithubRepoRef[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [name, setName] = useState('')
  const projects = useStore((s) => s.projects)
  const opened = useMemo(() => new Set(projects.map((p) => p.githubRepo?.toLowerCase()).filter(Boolean)), [projects])

  useEffect(() => {
    if (source !== 'github' || repos) return
    window.api
      .githubRepos()
      .then(setRepos)
      .catch((e) => setError((e as Error).message))
  }, [source, repos])

  const done = (p?: Project) => {
    if (!p) return
    const s = useStore.getState()
    s.upsertProject(p)
    s.startNew('feature', p.id)
    onClose()
  }

  const filtered = (repos ?? []).filter((r) => !q || `${r.nameWithOwner} ${r.description ?? ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <Modal title="Open a project" onClose={onClose} width={720}>
      <div className="flex flex-col gap-5">
        <Segmented<Source>
          value={source}
          onChange={setSource}
          options={[
            { value: 'github', label: <><Github className="size-4" /> From GitHub</> },
            { value: 'local', label: <><FolderOpen className="size-4" /> On this Mac</> },
            { value: 'new', label: <><Sparkles className="size-4" /> New Laravel app</> }
          ]}
        />

        {source === 'github' && (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your repositories…" className="h-10 pl-9 text-base" autoFocus />
            </div>
            {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
            {!repos && !error && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted">
                <Spinner /> Loading your repositories…
              </div>
            )}
            <ul className="max-h-[420px] overflow-y-auto">
              {filtered.map((r) => (
                <li key={r.nameWithOwner}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy(r.nameWithOwner)
                      done(await act(() => window.api.openGithubRepo(r.nameWithOwner)))
                      setBusy('')
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised disabled:opacity-60"
                  >
                    {r.isPrivate ? <Lock className="size-4 text-faint" /> : <Github className="size-4 text-faint" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base">{r.nameWithOwner}</span>
                      {r.description && <span className="block truncate text-sm text-faint">{r.description}</span>}
                    </span>
                    {r.permission === 'contributor' && (
                      <span className="flex items-center gap-1 text-xs text-faint" title="You'll work on your own copy (fork) and submit for review">
                        <GitFork className="size-3.5" /> via fork
                      </span>
                    )}
                    <RoleBadge role={r.permission} />
                    <span className="w-16 text-right text-xs text-faint">{timeAgo(r.updatedAt)}</span>
                    {busy === r.nameWithOwner ? <Spinner /> : opened.has(r.nameWithOwner.toLowerCase()) ? <Check className="size-4 text-ok" /> : null}
                  </button>
                </li>
              ))}
              {repos && filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-faint">No repositories match.</li>}
            </ul>
            <p className="text-xs text-faint">The repository is downloaded to your projects folder and set up automatically — dependencies, database and a local preview.</p>
          </div>
        )}

        {source === 'local' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">Pick a folder that contains a git repository.</p>
            <Button
              variant="primary"
              size="lg"
              icon={<FolderOpen className="size-5" />}
              onClick={async () => {
                onClose()
                await addProject()
              }}
            >
              Choose folder…
            </Button>
          </div>
        )}

        {source === 'new' && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim()) return
              setBusy('new')
              done(await act(() => window.api.createLaravelProject(name.trim())))
              setBusy('')
            }}
          >
            <p className="text-sm text-muted">A fresh Laravel app with a database and a local preview, ready to build on.</p>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name, e.g. Customer portal" className="h-10 text-base" autoFocus />
              <Button type="submit" variant="primary" size="lg" icon={<Plus className="size-5" />} loading={busy === 'new'} disabled={!name.trim()}>
                Create
              </Button>
            </div>
            {busy === 'new' && <p className="text-sm text-faint">Creating the app — this takes a minute the first time.</p>}
          </form>
        )}
      </div>
    </Modal>
  )
}

/** Progress of a project's automatic first-time setup, with friendly steps and recovery. */
export function ProjectSetupCard({ project }: { project: Project }) {
  const setup = project.setup
  const [showLog, setShowLog] = useState(false)
  if (!setup || setup.status === 'done') return null
  const failed = setup.status === 'failed'
  return (
    <div className={clsx('rounded-2xl border p-5', failed ? 'border-bad/40 bg-bad/[0.05]' : 'border-line-strong bg-panel')}>
      <div className="mb-3 flex items-center gap-2 text-base font-medium">
        {failed ? <X className="size-5 text-bad" /> : <Spinner className="size-5 text-info" />}
        {failed ? 'Setting up hit a snag' : `Getting ${project.name} ready`}
      </div>
      <ul className="flex flex-col gap-2">
        {setup.steps.map((s) => (
          <li key={s.id} className={clsx('flex items-start gap-2.5 text-sm', s.status === 'skipped' && 'text-faint', s.status === 'failed' && 'text-bad')}>
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {s.status === 'done' ? (
                <Check className="size-4 text-ok" />
              ) : s.status === 'running' ? (
                <Spinner className="size-4 text-info" />
              ) : s.status === 'failed' ? (
                <X className="size-4" />
              ) : (
                <CircleDashed className="size-4 text-faint" />
              )}
            </span>
            <span className="min-w-0">
              <span>{s.label}</span>
              {s.detail && s.status !== 'skipped' && <span className="ml-2 text-faint">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {failed && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<RotateCw className="size-4" />} onClick={() => void act(() => window.api.prepareProject(project.id))}>
            Try again
          </Button>
          <Button
            icon={<Sparkles className="size-4" />}
            onClick={async () => {
              const f = await act(() =>
                window.api.createFeature({
                  kind: 'chat',
                  projectId: project.id,
                  permissionMode: 'acceptEdits',
                  prompt: `Setting up this project failed at "${setup.steps.find((s) => s.status === 'failed')?.label}" with: ${setup.error}\n\nHere is the end of the setup log:\n\n\`\`\`\n${setup.log.split('\n').slice(-80).join('\n')}\n\`\`\`\n\nFigure out what is wrong and fix the local setup (dependencies, .env, database). Explain what you did in plain language.`
                })
              )
              if (f) {
                await useStore.getState().loadThread(f.id)
                useStore.getState().select(f.id)
              }
            }}
          >
            Ask AI to fix it
          </Button>
          <Button variant="ghost" onClick={() => setShowLog(!showLog)}>
            {showLog ? 'Hide details' : 'Show details'}
          </Button>
        </div>
      )}
      {showLog && <pre className="selectable mt-3 max-h-64 overflow-auto rounded-lg bg-bg p-3 font-mono text-xs whitespace-pre-wrap text-muted">{setup.log}</pre>}
    </div>
  )
}
