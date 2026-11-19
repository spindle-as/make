import clsx from 'clsx'
import { AlertTriangle, ArrowRight, CheckCircle2, Hand, MousePointerClick, Play, Rocket, ShieldCheck, Square } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ChatItem, Feature } from '@shared/types'
import { runAction } from '../lib/actions'
import { useWords } from '../lib/words'
import { act, actOk, useStore } from '../store'
import { Spinner, timeAgo } from './ui'
import { planFrom } from '../lib/todos'

const EMPTY: ChatItem[] = []

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** What the agent is doing right now, in a few words. */
function activity(items: ChatItem[]): string {
  let didSomething = false
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.role === 'user') break
    if (it.tool?.status === 'running') return it.tool.summary
    if (it.role === 'assistant' && it.status === 'running') return 'Writing a reply'
    if (it.role === 'thinking' && it.status === 'running') return 'Thinking'
    if (it.role === 'assistant' || it.role === 'tool') didSomething = true
  }
  return didSomething ? 'Wrapping up' : 'Getting started'
}

function Action({ children, onClick, primary, icon }: { children: ReactNode; onClick: () => void; primary?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'press flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium',
        primary ? 'bg-accent text-ink hover:bg-accent-strong' : 'bg-active text-fg hover:bg-line-strong'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * Always-visible strip above the message box: is the agent working, does it need you, or is it
 * your turn — and if so, what to do next.
 */
export function TurnStatus({ feature }: { feature: Feature }) {
  const w = useWords()
  const status = useStore((s) => s.statuses[feature.id])
  const requests = useStore((s) => s.requests[feature.id]?.length ?? 0)
  const planReady = useStore((s) => s.requests[feature.id]?.some((r) => r.toolName === 'ExitPlanMode') ?? false)
  const turn = useStore((s) => s.turns[feature.id])
  const items = useStore((s) => s.threads[feature.id] ?? EMPTY)
  const setTab = useStore((s) => s.setRightTab)
  const checks = useStore((s) => s.checks[feature.id])
  const running = status?.running ?? false
  const now = useNow(running)
  const agent = feature.agent === 'codex' ? 'Codex' : 'Claude'

  if (feature.cleanedUp || feature.stage === 'setup') return null

  if (requests > 0) {
    return (
      <Bar
        tone="warn"
        icon={<Hand className="size-4" />}
        title={planReady ? 'The plan is ready' : 'Waiting for you'}
        actions={<Action onClick={() => document.querySelector('[data-request-card]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Show me</Action>}
      />
    )
  }

  if (running) {
    return (
      <Bar
        tone="accent"
        icon={<Spinner className="text-info" />}
        title={<span className="shimmer-text">{agent} is working</span>}
        meta={turn?.startedAt ? fmt(now - turn.startedAt) : undefined}
        detail={(() => {
          // With a plan (TodoWrite), say which step it's on; otherwise what it's doing right now.
          const { todos } = planFrom(items)
          const idx = todos.findIndex((t) => t.status === 'in_progress')
          const doneCount = todos.filter((t) => t.status === 'completed').length
          if (todos.length && idx >= 0) {
            return (
              <span>
                Step {idx + 1} of {todos.length}: {todos[idx].content} <span className="text-faint">· {doneCount} done</span>
              </span>
            )
          }
          return <span className="font-mono">{activity(items)}</span>
        })()}
        progress
        actions={
          <Action icon={<Square className="size-3.5" />} onClick={() => void act(() => window.api.stopAgent(feature.id))}>
            Stop
          </Action>
        }
      />
    )
  }

  if (status?.error) {
    return (
      <Bar
        tone="bad"
        icon={<AlertTriangle className="size-4" />}
        title="Stopped with a problem"
        detail={status.error}
        actions={
          <Action primary icon={<Play className="size-3.5" />} onClick={() => void actOk(() => window.api.sendPrompt(feature.id, 'Continue where you left off.'))}>
            Continue
          </Action>
        }
      />
    )
  }

  // Nothing asked yet (a brand-new change only has its setup card): the message box says enough.
  if (!items.some((i) => i.role === 'user')) return null
  const finished = turn?.endedAt ? `finished ${timeAgo(turn.endedAt)}` : undefined

  if (feature.kind === 'chat') {
    return (
      <Bar
        tone="ok"
        icon={<CheckCircle2 className="size-4" />}
        title="Your turn"
        meta={finished}
        actions={
          feature.projectId ? (
            <Action icon={<ArrowRight className="size-3.5" />} onClick={() => void runAction('promote')}>
              Continue as a change
            </Action>
          ) : undefined
        }
      />
    )
  }

  // A change: say plainly what the next step is for where it stands.
  const lastRun = checks?.results.length ? checks.results : latestChecks(feature.checks ?? [])
  const failedChecks = checks?.running ? 0 : lastRun.filter((r) => !r.ok).length
  switch (feature.stage) {
    case 'coding':
    case 'testing':
      return (
        <Bar
          tone="ok"
          icon={<CheckCircle2 className="size-4" />}
          title="Your turn"
          meta={finished}
          detail={checks?.running ? 'Checks running…' : failedChecks ? `${failedChecks} check${failedChecks > 1 ? 's' : ''} failed` : undefined}
          actions={
            <>
              {feature.localUrl && (
                <Action primary={!checks?.results.length} icon={<MousePointerClick className="size-3.5" />} onClick={() => setTab('preview')}>
                  Try it
                </Action>
              )}
              <Action primary={!feature.localUrl || !!checks?.results.length} icon={<ShieldCheck className="size-3.5" />} onClick={() => setTab('ship')}>
                {w.checkAndSubmit}
              </Action>
            </>
          }
        />
      )
    case 'pr':
      return (
        <Bar
          tone="info"
          icon={<CheckCircle2 className="size-4" />}
          title="Submitted"
          actions={<Action onClick={() => setTab('ship')}>See status</Action>}
        />
      )
    case 'merged':
      return (
        <Bar
          tone="ok"
          icon={<CheckCircle2 className="size-4" />}
          title={w.stages.merged}
          actions={
            <Action icon={<Rocket className="size-3.5" />} onClick={() => setTab('ship')}>
              {w.deploy}
            </Action>
          }
        />
      )
    case 'deployed':
      return (
        <Bar
          tone="ok"
          icon={<Rocket className="size-4" />}
          title="Live"
          actions={
            <Action primary onClick={() => useStore.getState().startNew('feature', feature.projectId)}>
              {w.newFeature}
            </Action>
          }
        />
      )
    default:
      return null
  }
}

/** Latest result per check name from the saved history. */
function latestChecks(all: NonNullable<Feature['checks']>) {
  const m = new Map<string, (typeof all)[number]>()
  for (const r of all) m.set(r.name, r)
  return [...m.values()]
}

function Bar({
  tone,
  icon,
  title,
  meta,
  detail,
  actions,
  progress
}: {
  tone: 'accent' | 'warn' | 'ok' | 'bad' | 'info'
  icon: ReactNode
  title: ReactNode
  meta?: ReactNode
  detail?: ReactNode
  actions?: ReactNode
  progress?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        // Material 3: a tonal surface, no outline; colour only for "working", "needs you" and problems.
        'relative mb-3 flex items-center gap-3 overflow-hidden rounded-2xl py-2.5 pr-2.5 pl-4 text-sm',
        tone === 'accent' && 'bg-info/10',
        tone === 'warn' && 'bg-warn/15',
        tone === 'ok' && 'bg-raised',
        tone === 'bad' && 'bg-bad/12',
        tone === 'info' && 'bg-raised'
      )}
    >
      <span className={clsx('flex shrink-0', tone === 'warn' && 'text-warn', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'info' && 'text-muted')}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-semibold">{title}</span>
          {meta && <span className="min-w-0 truncate text-xs text-muted tabular-nums">{meta}</span>}
        </div>
        {detail && <div className="line-clamp-2 text-sm text-muted">{detail}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      {progress && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden>
          <span className="magic-progress block h-full w-1/3" style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }} />
        </span>
      )}
    </div>
  )
}
