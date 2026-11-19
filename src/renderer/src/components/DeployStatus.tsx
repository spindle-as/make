import clsx from 'clsx'
import { Check, ChevronRight, ExternalLink, Loader2, Rocket, Wand2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DeploymentInfo, DeployState, Environment, Feature, Project } from '@shared/types'
import { act, useStore } from '../store'
import { Badge, Button, IconButton, timeAgo } from './ui'

const EMPTY_DEPLOYS: Record<string, DeployState> = {}

export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
}

const running = (d?: DeployState) => !!d && (d.status === 'queued' || d.status === 'deploying')

function useProjectDeploys(projectId: string): DeployState[] {
  const all = useStore((s) => s.deploys ?? EMPTY_DEPLOYS)
  return Object.values(all).filter((d) => d.projectId === projectId)
}

/** Compact live status for the most relevant environment; clicking opens the Ship tab. */
export function DeployPill({ project, feature }: { project: Project; feature?: Feature }) {
  const deploys = useProjectDeploys(project.id)
  const setTab = useStore((s) => s.setRightTab)
  const active = deploys.find(running)
  const recent = deploys
    .filter((d) => !running(d) && d.finishedAt && Date.now() - d.finishedAt < 60 * 60_000 && (!feature || d.featureId === feature.id || feature.stage === 'merged' || feature.stage === 'deployed'))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]
  const d = active ?? recent
  const now = useNow(!!active)
  if (!d) return null
  const env = project.environments.find((e) => e.id === d.envId)
  const name = env?.name ?? 'deploy'
  return (
    <button
      type="button"
      onClick={() => setTab('ship')}
      className={clsx(
        'no-drag flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors',
        running(d) && 'border-info/40 bg-info/10 text-info',
        d.status === 'success' && 'border-ok/30 bg-ok/10 text-ok',
        d.status === 'failed' && 'border-bad/40 bg-bad/10 text-bad'
      )}
      title="Open the Ship tab"
    >
      {running(d) ? <Loader2 className="size-4 animate-spin" /> : d.status === 'success' ? <Check className="size-4" /> : <X className="size-4" />}
      {running(d) ? (
        <>
          Deploying to {name}
          <span className="font-mono text-xs tabular-nums opacity-80">{d.startedAt ? duration(now - d.startedAt) : ''}</span>
        </>
      ) : d.status === 'success' ? (
        <>
          Deployed to {name} <span className="text-xs font-normal opacity-80">{d.finishedAt ? timeAgo(d.finishedAt) : ''}</span>
        </>
      ) : (
        <>Deploy to {name} failed</>
      )}
    </button>
  )
}

/** Small indicator for the sidebar project row. */
export function ProjectDeployDot({ projectId }: { projectId: string }) {
  const deploys = useProjectDeploys(projectId)
  const active = deploys.some(running)
  const lastFailed = deploys.some((d) => d.status === 'failed' && d.finishedAt && Date.now() - d.finishedAt < 30 * 60_000)
  if (!active && !lastFailed) return null
  return (
    <span title={active ? 'Deploying…' : 'A recent deploy failed'} className="flex items-center">
      {active ? <Rocket className="pulse size-3.5 text-info" /> : <Rocket className="size-3.5 text-bad" />}
    </span>
  )
}

function History({ project, env, refreshKey }: { project: Project; env: Environment; refreshKey: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<DeploymentInfo[] | null>(null)
  const [log, setLog] = useState<{ id: string; text: string } | null>(null)
  useEffect(() => {
    if (!open) return
    window.api.deployHistory(project.id, env.id).then(setItems).catch(() => setItems([]))
  }, [open, project.id, env.id, refreshKey])
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ChevronRight className={clsx('size-4 transition-transform', open && 'rotate-90')} /> Recent deployments
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1">
          {items === null && <li className="text-sm text-faint">Loading…</li>}
          {items?.length === 0 && <li className="text-sm text-faint">No deployments yet.</li>}
          {items?.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={async () => {
                  if (log?.id === d.id) return setLog(null)
                  const text = await act(() => window.api.deploymentLog(project.id, env.id, d.id!))
                  if (text !== undefined) setLog({ id: d.id!, text })
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-raised"
              >
                {d.status === 'success' ? <Check className="size-4 text-ok" /> : <X className="size-4 text-bad" />}
                <span className="font-mono text-xs text-faint">{d.commit?.slice(0, 7) ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate">{d.message || d.status}</span>
                <span className="shrink-0 text-xs text-faint">{d.at ? timeAgo(d.at) : ''}</span>
              </button>
              {log && log.id === d.id && (
                <pre className="selectable mt-1 mb-2 max-h-60 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-xs whitespace-pre-wrap text-muted">{log.text || 'No log.'}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function EnvDeployCard({ project, env, feature }: { project: Project; env: Environment; feature: Feature }) {
  const d = useStore((s) => s.deploys?.[`${project.id}:${env.id}`])
  const hasToken = useStore((s) => s.settings?.hasPloiToken)
  const linked = !!(env.ploiServerId && env.ploiSiteId)
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const isRunning = running(d)
  const now = useNow(isRunning)

  useEffect(() => {
    if (d?.status === 'failed') setShowLog(true)
  }, [d?.status, d?.finishedAt])

  const deploy = async () => {
    if (feature.kind === 'feature' && !['merged', 'deployed'].includes(feature.stage) && env.branch === feature.baseBranch) {
      if (!confirm(`This feature isn't merged into ${env.branch} yet, so it won't be in this deploy. Deploy ${env.branch} to ${env.name} anyway?`)) return
    }
    setBusy(true)
    await act(() => window.api.deploy(project.id, env.id, feature.id))
    setBusy(false)
  }

  const fix = () =>
    act(
      () =>
        window.api.sendPrompt(
          feature.id,
          `The Ploi deployment of ${project.name} to ${env.name} failed. Here is the end of the deploy log. Find the cause and fix it in this branch if it is a code problem; otherwise explain what needs changing on the server.\n\n\`\`\`\n${(d?.log ?? d?.error ?? '').split('\n').slice(-150).join('\n')}\n\`\`\``
        ),
      'Sent to the agent'
    )

  const took = d?.startedAt && d.finishedAt ? duration(d.finishedAt - d.startedAt) : undefined

  return (
    <div
      className={clsx(
        'rounded-xl border p-4 transition-colors',
        isRunning ? 'border-info/40 bg-info/[0.06]' : d?.status === 'failed' ? 'border-bad/40 bg-bad/[0.04]' : 'border-line bg-raised/40'
      )}
    >
      <div className="flex items-center gap-2.5">
        <Rocket className={clsx('size-5', isRunning ? 'pulse text-info' : 'text-muted')} />
        <span className="text-base font-medium capitalize">{env.name}</span>
        <span className="font-mono text-xs text-faint">← {env.branch}</span>
        {env.autoDeployOnMerge && <Badge tone="info">auto on merge</Badge>}
        <div className="flex-1" />
        {env.url && (
          <IconButton title="Open site" onClick={() => void window.api.openExternal(env.url!)}>
            <ExternalLink className="size-4" />
          </IconButton>
        )}
        <Button variant={isRunning ? 'secondary' : 'primary'} icon={<Rocket className="size-4" />} onClick={deploy} loading={busy} disabled={!linked || !hasToken || isRunning}>
          {isRunning ? 'Deploying…' : d?.status ? 'Redeploy' : 'Deploy'}
        </Button>
      </div>

      {!hasToken && <div className="mt-3 text-sm text-faint">Connect Ploi in Settings → Integrations to deploy.</div>}
      {hasToken && !linked && <div className="mt-3 text-sm text-faint">Link this environment to a Ploi site in project settings.</div>}

      {isRunning && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-sm text-info">
            <Loader2 className="size-4 animate-spin" />
            {d!.status === 'queued' ? 'Queuing deployment…' : 'Deploying'}
            {d!.startedAt && <span className="font-mono tabular-nums">{duration(now - d!.startedAt)}</span>}
            <span className="text-faint">· {d!.source === 'ploi' ? 'started by Ploi (push to ' + env.branch + ')' : 'started from here'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-accent" />
          </div>
          <div className="mt-1.5 text-xs text-faint">Ploi shares the log once the deployment finishes. You'll get a notification.</div>
        </div>
      )}

      {!isRunning && d && d.status !== 'idle' && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {d.status === 'success' ? <Check className="size-4 text-ok" /> : <X className="size-4 text-bad" />}
          <span className={d.status === 'success' ? 'text-ok' : 'text-bad'}>{d.status === 'success' ? 'Deployed' : 'Failed'}</span>
          {d.finishedAt && <span className="text-muted">{timeAgo(d.finishedAt)}</span>}
          {took && <span className="text-faint">· took {took}</span>}
          {d.commit && <span className="font-mono text-xs text-faint">· {d.commit.slice(0, 7)}</span>}
          {d.message && <span className="selectable min-w-0 truncate text-muted">· {d.message.split('\n')[0]}</span>}
          {d.error && <span className="text-bad">· {d.error}</span>}
          <div className="flex-1" />
          {(d.log || d.error) && (
            <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>
              {showLog ? 'Hide log' : 'Show log'}
            </Button>
          )}
          {d.status === 'failed' && (
            <Button size="sm" variant="ghost" icon={<Wand2 className="size-4" />} onClick={fix}>
              Fix with agent
            </Button>
          )}
        </div>
      )}
      {!isRunning && showLog && (d?.log || d?.error) && (
        <pre className="selectable mt-2 max-h-72 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-xs whitespace-pre-wrap text-muted">{d.log || d.error}</pre>
      )}
      {!d && linked && hasToken && <div className="mt-3 text-sm text-faint">No deployments tracked yet.</div>}

      {linked && hasToken && <History project={project} env={env} refreshKey={`${d?.deploymentId}-${d?.status}`} />}
    </div>
  )
}
