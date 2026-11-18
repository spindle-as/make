import clsx from 'clsx'
import {
  Check,
  CircleDashed,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  RefreshCw,
  RotateCcw,
  Upload,
  Wand2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ciGate } from '@shared/ci'
import type { CheckRun, Feature, GitStatusInfo, Project, PullRequestInfo, WorkflowRun } from '@shared/types'
import { EnvDeployCard } from '../components/DeployStatus'
import { ChecksSection } from './ReviewPanel'
import { Badge, Button, Field, IconButton, Input, SectionTitle, Spinner, Textarea, Toggle, timeAgo } from '../components/ui'
import { act, actOk, useStore } from '../store'

function CheckIcon({ bucket }: { bucket: CheckRun['bucket'] }) {
  if (bucket === 'pass') return <Check className="size-4 text-ok" />
  if (bucket === 'fail') return <X className="size-4 text-bad" />
  if (bucket === 'pending') return <Spinner className="text-warn" />
  return <CircleDashed className="size-4 text-faint" />
}

function runTone(r: WorkflowRun): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (r.status !== 'completed') return 'warn'
  if (r.conclusion === 'success') return 'ok'
  if (r.conclusion === 'failure' || r.conclusion === 'timed_out') return 'bad'
  return 'neutral'
}

function defaultBody(feature: Feature, lastAssistant?: string): string {
  const parts = [`## ${feature.title}`, '']
  if (lastAssistant) parts.push(lastAssistant.trim().slice(0, 3000), '')
  parts.push('---', `Built with Software Factory (${feature.agent === 'codex' ? 'Codex' : 'Claude Code'}).`)
  return parts.join('\n')
}

async function fixWithAgent(feature: Feature, prompt: string) {
  if (await actOk(() => window.api.sendPrompt(feature.id, prompt))) useStore.getState().toast('info', 'Sent to the agent')
}

export function ShipPanel({ feature, project }: { feature: Feature; project: Project }) {
  const thread = useStore((s) => s.threads[feature.id])
  const settings = useStore((s) => s.settings)
  const tick = useStore((s) => s.fsTick[feature.id] ?? 0)
  const [status, setStatus] = useState<GitStatusInfo | null>(null)
  const [pr, setPr] = useState<PullRequestInfo | null>(null)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [title, setTitle] = useState(feature.title)
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [runLog, setRunLog] = useState<{ id: number; text: string } | null>(null)

  const lastAssistant = thread ? [...thread].reverse().find((i) => i.role === 'assistant')?.text : undefined

  const refresh = useCallback(async () => {
    setLoading(true)
    const [s, p, r] = await Promise.all([
      window.api.gitStatus(feature.id).catch(() => null),
      project.githubRepo && !feature.inPlace ? window.api.getPr(feature.id).catch(() => null) : Promise.resolve(null),
      project.githubRepo ? window.api.listRuns(feature.id).catch(() => []) : Promise.resolve([])
    ])
    setStatus(s)
    setPr(p)
    setRuns(r)
    setLoading(false)
  }, [feature.id, project.githubRepo, feature.inPlace])

  useEffect(() => {
    void refresh()
  }, [refresh, tick, feature.stage])

  useEffect(() => {
    setTitle(feature.title)
    setBody('')
  }, [feature.id, feature.title])

  // Poll while CI is in progress.
  const pending = pr?.checks.some((c) => c.bucket === 'pending') || runs.some((r) => r.status !== 'completed')
  useEffect(() => {
    if (!pending) return
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [pending, refresh])

  const openPr = async () => {
    setBusy('pr')
    const r = await act(
      () => window.api.createPr(feature.id, { title: title.trim() || feature.title, body: body.trim() || defaultBody(feature, lastAssistant), draft }),
      'Pull request opened'
    )
    if (r) setPr(r)
    setBusy('')
    void refresh()
  }

  const merge = async () => {
    if (!pr) return
    setBusy('merge')
    await act(() => window.api.mergePr(feature.id), `Merged #${pr.number}`)
    setBusy('')
    void refresh()
  }

  const push = async () => {
    setBusy('push')
    await act(() => window.api.push(feature.id), 'Pushed')
    setBusy('')
    void refresh()
  }

  const viewLog = async (run: WorkflowRun) => {
    if (runLog?.id === run.databaseId) return setRunLog(null)
    setBusy(`log-${run.databaseId}`)
    const text = await act(() => window.api.failedRunLog(run.databaseId, project.id))
    setBusy('')
    if (text !== undefined) setRunLog({ id: run.databaseId, text })
  }

  const fixRun = async (run: WorkflowRun) => {
    setBusy(`fix-${run.databaseId}`)
    const text = await act(() => window.api.failedRunLog(run.databaseId, project.id))
    setBusy('')
    if (text === undefined) return
    await fixWithAgent(
      feature,
      `The GitHub Actions workflow "${run.name}" failed on this branch (${run.url}). Here are the failed job logs. Find the root cause, fix it, and run the relevant checks locally to confirm.\n\n\`\`\`\n${text}\n\`\`\``
    )
  }

  const envs = project.environments
  const gate = ciGate(pr?.checks ?? [], runs)
  const canMerge = pr?.state === 'OPEN' && !pr.isDraft && pr.mergeable !== 'CONFLICTING' && gate.ok

  if (feature.inPlace) {
    return (
      <div className="p-4 text-xs text-muted">
        This feature works directly in the main checkout on <span className="font-mono">{feature.branch}</span>. Use a worktree feature for the PR flow,
        or deploy below.
        <div className="mt-4 flex flex-col gap-2">
          {envs.map((e) => (
            <EnvDeployCard key={e.id} project={project} env={e} feature={feature} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-sm font-semibold">Ship</div>
        <div className="flex-1" />
        <IconButton title="Refresh" onClick={refresh}>
          {loading ? <Spinner /> : <RefreshCw className="size-4" />}
        </IconButton>
      </div>

      <div className="mb-5">
        <ChecksSection feature={feature} />
      </div>

      {/* Branch */}
      <section className="mb-5">
        <SectionTitle>Branch</SectionTitle>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/50 p-3 text-xs">
          <span className="font-mono">{feature.branch}</span>
          <span className="text-faint">→ {feature.baseBranch}</span>
          <div className="flex-1" />
          {status && (
            <>
              {status.dirty && <Badge tone="warn">uncommitted</Badge>}
              <Badge>{status.commitsAhead.length} commits</Badge>
              {status.ahead > 0 && <Badge tone="info">{status.ahead} unpushed</Badge>}
            </>
          )}
          {pr && status && status.ahead > 0 && (
            <Button size="sm" icon={<Upload className="size-4" />} loading={busy === 'push'} onClick={push}>
              Push
            </Button>
          )}
        </div>
        {status && status.commitsAhead.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 pl-1">
            {status.commitsAhead.slice(0, 8).map((c) => (
              <li key={c.sha} className="selectable truncate text-xs text-muted">
                <span className="mr-2 font-mono text-faint">{c.sha}</span>
                {c.subject}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pull request */}
      <section className="mb-5">
        <SectionTitle>Pull request</SectionTitle>
        {!project.githubRepo ? (
          <div className="text-xs text-faint">No GitHub remote configured for this project.</div>
        ) : !pr ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised/50 p-3">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              icon={<Wand2 className="size-4" />}
              loading={busy === 'draft'}
              onClick={async () => {
                setBusy('draft')
                const d = await act(() => window.api.draftPr(feature.id))
                if (d) {
                  setTitle(d.title)
                  setBody(d.body)
                }
                setBusy('')
              }}
            >
              Write description with AI (from the diff and check results)
            </Button>
            <Field label="Description" hint="Leave empty to use the agent's last summary.">
              <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={defaultBody(feature, lastAssistant).slice(0, 300)} />
            </Field>
            <div className="flex items-center gap-3">
              <Toggle checked={draft} onChange={setDraft} label="Draft" />
              <div className="flex-1" />
              <Button variant="primary" icon={<GitPullRequest className="size-4" />} loading={busy === 'pr'} onClick={openPr}>
                {status?.dirty ? 'Commit, push & open PR' : 'Push & open PR'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-raised/50 p-3">
            <div className="flex items-center gap-2">
              <GitPullRequest className={clsx('size-4', pr.state === 'MERGED' ? 'text-accent-strong' : pr.state === 'OPEN' ? 'text-ok' : 'text-bad')} />
              <button className="truncate text-left text-sm font-medium hover:underline" onClick={() => void window.api.openExternal(pr.url)}>
                #{pr.number} {pr.title}
              </button>
              <div className="flex-1" />
              <Badge tone={pr.state === 'MERGED' ? 'accent' : pr.state === 'OPEN' ? 'ok' : 'bad'}>{pr.isDraft ? 'draft' : pr.state.toLowerCase()}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-faint">
              {pr.mergeable === 'CONFLICTING' && <Badge tone="bad">conflicts</Badge>}
              {pr.reviewDecision && <Badge tone={pr.reviewDecision === 'APPROVED' ? 'ok' : 'warn'}>{pr.reviewDecision.replace('_', ' ').toLowerCase()}</Badge>}
              {pr.mergeStateStatus && pr.state === 'OPEN' && <span>merge state: {pr.mergeStateStatus.toLowerCase()}</span>}
            </div>
            {pr.checks.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {pr.checks.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <CheckIcon bucket={c.bucket} />
                    <span className="truncate">{c.workflow ? `${c.workflow} / ` : ''}{c.name}</span>
                    <div className="flex-1" />
                    {c.link && (
                      <IconButton title="Open" className="size-5" onClick={() => void window.api.openExternal(c.link!)}>
                        <ExternalLink className="size-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {pr.state === 'OPEN' && !project.access?.canMerge && (
              <div className="mt-3 text-sm text-faint">Your GitHub role ({project.access?.role ?? 'unknown'}) can’t merge here — a maintainer will review and merge it.</div>
            )}
            {pr.state === 'OPEN' && project.access?.canMerge && (
              <div className="mt-3 flex items-center gap-2">
                {pr.mergeable === 'CONFLICTING' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Wand2 className="size-4" />}
                    onClick={() =>
                      fixWithAgent(
                        feature,
                        `This branch has merge conflicts with ${feature.baseBranch}. Run \`git fetch origin ${feature.baseBranch} && git merge origin/${feature.baseBranch}\`, resolve all conflicts preserving both intents, run the tests, and commit the merge.`
                      )
                    }
                  >
                    Resolve conflicts with agent
                  </Button>
                )}
                <div className="flex-1" />
                {!gate.ok && <span className={clsx('text-sm', gate.state === 'failed' ? 'text-bad' : 'text-warn')}>{gate.reason}</span>}
                <Button variant="success" icon={<GitMerge className="size-4" />} loading={busy === 'merge'} disabled={!canMerge} onClick={merge} title={gate.reason}>
                  {settings?.mergeMethod === 'squash' ? 'Squash & merge' : settings?.mergeMethod === 'rebase' ? 'Rebase & merge' : 'Merge'}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* CI */}
      {project.githubRepo && (
        <section className="mb-5">
          <SectionTitle>CI runs</SectionTitle>
          {runs.length === 0 ? (
            <div className="text-xs text-faint">No workflow runs for this branch yet{pr ? '' : ' — they start when you push'}.</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {runs.slice(0, 8).map((r) => (
                <li key={r.databaseId} className="rounded-md border border-line bg-raised/40 px-2.5 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone={runTone(r)}>{r.status === 'completed' ? r.conclusion || 'done' : r.status.replace('_', ' ')}</Badge>
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="truncate text-faint">{r.displayTitle}</span>
                    <div className="flex-1" />
                    <span className="shrink-0 text-xs text-faint">{timeAgo(r.createdAt)}</span>
                    <IconButton title="Open on GitHub" className="size-5" onClick={() => void window.api.openExternal(r.url)}>
                      <ExternalLink className="size-3.5" />
                    </IconButton>
                  </div>
                  {r.conclusion === 'failure' && (
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" variant="ghost" loading={busy === `log-${r.databaseId}`} onClick={() => viewLog(r)}>
                        {runLog?.id === r.databaseId ? 'Hide log' : 'Failed log'}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Wand2 className="size-4" />} loading={busy === `fix-${r.databaseId}`} onClick={() => fixRun(r)}>
                        Fix with agent
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw className="size-4" />}
                        onClick={async () => {
                          await act(() => window.api.rerunFailed(r.databaseId, project.id), 'Re-running failed jobs')
                          void refresh()
                        }}
                      >
                        Re-run
                      </Button>
                    </div>
                  )}
                  {runLog?.id === r.databaseId && (
                    <pre className="selectable mt-2 max-h-72 overflow-auto rounded bg-bg p-2 font-mono text-2xs whitespace-pre-wrap text-muted">{runLog.text}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Deploy */}
      <section className="mb-5">
        <SectionTitle>Deploy (Ploi)</SectionTitle>
        {envs.length === 0 ? (
          <div className="text-xs text-faint">
            No environments yet.{' '}
            <button className="text-accent-strong hover:underline" onClick={() => useStore.getState().openModal({ kind: 'project', projectId: project.id })}>
              Add one in project settings
            </button>
            .
          </div>
        ) : !project.access?.canDeploy ? (
          <div className="text-sm text-faint">Deploying needs maintainer access{project.access ? ` (you are: ${project.access.role})` : ''}, and it is never available on a contributor-only machine.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {envs.map((e) => (
              <EnvDeployCard key={e.id} project={project} env={e} feature={feature} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
