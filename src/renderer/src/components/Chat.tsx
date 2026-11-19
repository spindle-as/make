import clsx from 'clsx'
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleDashed,
  FileEdit,
  FileText,
  Globe,
  ListTodo,
  MessageSquare,
  Search,
  Terminal,
  Wrench,
  X
} from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatItem, DevEnvView, Feature } from '@shared/types'
import { act, actOk, useStore } from '../store'
import { Composer, type AgentConfig } from './Composer'
import { TrustBanner } from './DevEnvEditor'
import { TurnStatus } from './TurnStatus'
import { useIsCreator } from '../lib/words'
import { isPlanTool, planFrom, type PlanItem } from '../lib/todos'
import { RequestCards } from './RequestCards'
import { Empty, Spinner } from './ui'

const EMPTY: ChatItem[] = []

function toolIcon(name: string) {
  const c = 'size-4'
  if (name === 'Bash') return <Terminal className={c} />
  if (/Edit|Write|Notebook/.test(name)) return <FileEdit className={c} />
  if (name === 'Read') return <FileText className={c} />
  if (/Grep|Glob/.test(name)) return <Search className={c} />
  if (/Web/.test(name)) return <Globe className={c} />
  if (/Todo/.test(name)) return <ListTodo className={c} />
  return <Wrench className={c} />
}

const ToolRow = memo(function ToolRow({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false)
  const t = item.tool!
  return (
    <div className="rounded-xl border border-line bg-panel/70">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm"
      >
        <ChevronRight className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <span className="text-muted">{toolIcon(t.name)}</span>
        <span className="shrink-0 font-medium text-fg">{t.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{t.summary}</span>
        {t.status === 'running' ? (
          <Spinner className="text-info" />
        ) : t.status === 'ok' ? (
          <Check className="size-4 text-ok" />
        ) : (
          <X className="size-4 text-bad" />
        )}
      </button>
      {open && (
        <div className="selectable border-t border-line px-3.5 py-2.5">
          {t.input && <pre className="mb-2 max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">{t.input}</pre>}
          {t.output && (
            <pre className={clsx('max-h-80 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-xs whitespace-pre-wrap', t.status === 'error' ? 'text-bad' : 'text-fg/90')}>
              {t.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
})

/** The agent's plan as a live checklist. Older updates collapse to a line. */
const TodoCard = memo(function TodoCard({ item, latest, todos }: { item: ChatItem; latest: boolean; todos: PlanItem[] }) {
  const done = todos.filter((t) => t.status === 'completed').length
  const [open, setOpen] = useState(latest)
  useEffect(() => setOpen(latest), [latest])
  if (!todos.length) return <ToolRow item={item} />
  return (
    <div className="rise-in rounded-xl border border-line bg-panel/70">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm">
        <ListTodo className="size-4 text-muted" />
        <span className="font-medium">{latest ? 'Plan' : 'Plan updated'}</span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${(done / todos.length) * 100}%` }} />
        </div>
        <span className="text-xs text-faint tabular-nums">
          {done}/{todos.length}
        </span>
        <div className="flex-1" />
        <ChevronRight className={clsx('size-3.5 text-faint transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="flex flex-col gap-1 border-t border-line px-3.5 py-2.5">
          {todos.map((t, i) => (
            <li key={i} className={clsx('flex items-start gap-2 text-sm', t.status === 'completed' ? 'text-faint line-through' : t.status === 'in_progress' ? 'text-fg' : 'text-muted')}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {t.status === 'completed' ? <Check className="size-3.5 text-ok" /> : t.status === 'in_progress' ? <CircleDashed className="size-3.5 animate-spin text-info" /> : <span className="size-2.5 rounded-full border border-line-strong" />}
              </span>
              <span className={t.status === 'in_progress' ? 'shimmer-text font-medium' : ''}>{t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

/** A subagent (Task/Agent call) with its own steps nested inside, live. */
const SubagentCard = memo(function SubagentCard({ item, steps }: { item: ChatItem; steps: ChatItem[] }) {
  const [open, setOpen] = useState(false)
  const t = item.tool!
  let type = ''
  try {
    type = (JSON.parse(t.input ?? '{}') as { subagent_type?: string }).subagent_type ?? ''
  } catch {
    /* fine */
  }
  const tools = steps.filter((s) => s.role === 'tool')
  const current = [...steps].reverse().find((s) => s.tool?.status === 'running')
  return (
    <div className={clsx('rise-in rounded-xl border bg-panel/70', t.status === 'running' ? 'border-info/30' : 'border-line')}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm">
        <ChevronRight className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <Bot className="size-4 text-muted" />
        <span className="shrink-0 font-medium">{type ? `${type} subagent` : 'Subagent'}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {t.status === 'running' && current?.tool ? (
            <>
              <span className="shimmer-text">{current.tool.name}</span> <span className="font-mono">{current.tool.summary}</span>
            </>
          ) : (
            t.summary
          )}
        </span>
        <span className="shrink-0 text-2xs text-faint tabular-nums">
          {tools.length} step{tools.length === 1 ? '' : 's'}
        </span>
        {t.status === 'running' ? <Spinner className="text-info" /> : t.status === 'ok' ? <Check className="size-4 text-ok" /> : <X className="size-4 text-bad" />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
          {steps.map((s) => (s.role === 'tool' ? <ToolRow key={s.id} item={s} /> : s.role === 'assistant' ? <div key={s.id} className="prose-chat text-sm text-muted">{md(s.text)}</div> : null))}
          {t.output && t.status !== 'running' && (
            <div className="rounded-lg bg-bg p-2.5">
              <div className="mb-1 text-2xs font-semibold tracking-wider text-faint uppercase">Result</div>
              <div className="prose-chat selectable text-sm">{md(t.output)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

const Thinking = memo(function Thinking({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 rounded-md text-sm text-faint hover:text-muted">
        <Brain className="size-4" /> {item.status === 'running' ? 'Thinking…' : 'Thought process'}
        <ChevronRight className={clsx('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="selectable mt-1.5 border-l-2 border-line pl-3 text-sm whitespace-pre-wrap text-muted italic">{item.text}</div>}
    </div>
  )
})

/** Live checklist (e.g. worktree setup). Lines starting with "…" are in progress. */
/** Setup steps in words a creator understands (developers see the technical list). */
export function friendlyStep(line: string): string {
  const l = line.replace(/^[✓✗…!⚠]\s*/, '')
  const map: [RegExp, string][] = [
    [/^Creating worktree|Worktree ready|Working directly/i, 'your own copy of the project'],
    [/Email is captured/i, 'emails stay inside Spindle'],
    [/preview:|Local site/i, 'its own website'],
    [/Cloning the database|Creating a database|Own database|Shares the main database|Database/i, 'its own data'],
    [/PHP packages|JavaScript packages|Installing dependencies/i, 'installing what it needs'],
    [/interface|assets/i, 'building the interface'],
    [/migrations|sample data|seed/i, 'preparing the data'],
    [/storage|Passport|keys/i, 'finishing touches'],
    [/^Started|Starting/i, 'starting the app']
  ]
  return map.find(([re]) => re.test(l))?.[1] ?? l.toLowerCase()
}

/** Creator mode: one progress bar and plain words; the technical list sits behind "Details". */
function CreatorSetupCard({ item, lines }: { item: ChatItem; lines: string[] }) {
  const [open, setOpen] = useState(false)
  const featureId = item.id.split('-')[1]
  const feature = useStore((s) => s.features.find((f) => f.id === featureId))
  const done = lines.filter((l) => l.startsWith('✓')).length
  const current = lines.find((l) => l.startsWith('…'))
  const failed = item.status === 'error'
  const needsOk = lines.some((l) => l.includes('haven’t approved'))
  const pct = item.status === 'ok' ? 100 : Math.min(92, Math.round((done / Math.max(7, done + 1)) * 100))
  return (
    <div className={clsx('rise-in rounded-xl border px-4 py-3.5', failed ? 'border-bad/30 bg-bad/5' : 'border-line bg-raised/40')}>
      <div className="flex items-center gap-2.5">
        {item.status === 'running' ? <Spinner className="text-info" /> : failed ? <AlertTriangle className="size-4 text-bad" /> : <Check className="size-4 text-ok" />}
        <span className="text-sm font-medium">
          {item.status === 'running' ? 'Getting your copy ready' : failed ? 'Something went wrong getting your copy ready' : needsOk ? 'Almost ready' : 'Your copy is ready'}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={() => setOpen(!open)} className="text-xs text-faint hover:text-fg">
          {open ? 'Hide details' : 'Details'}
        </button>
      </div>
      {!failed && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-hover">
          <div className={clsx('h-full rounded-full transition-[width] duration-700', item.status === 'ok' ? 'bg-ok' : 'bg-info')} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-2 text-sm text-muted">
        {item.status === 'running'
          ? `${current ? friendlyStep(current).replace(/^./, (c) => c.toUpperCase()) : 'Starting'}… This takes a minute the first time.`
          : failed
            ? 'Claude can usually fix this for you.'
            : needsOk
              ? 'One last step: allow your team’s setup below, and Spindle finishes getting your copy ready.'
              : 'It has its own website, data and email inbox — nothing you do here affects the real thing. Try it, or describe what to build.'}
      </p>
      {failed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void actOk(() =>
                window.api.sendPrompt(
                  featureId,
                  `Getting this change's workspace ready failed. Here is the end of the setup log:\n\n\`\`\`\n${(feature?.setupLog ?? '').slice(-4000)}\n\`\`\`\n\nFind the cause and fix it, then explain in one or two plain sentences what was wrong.`
                )
              )
            }
            className="press flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-ink"
          >
            <Wrench className="size-3.5" /> Fix it for me
          </button>
          <button type="button" onClick={() => void act(() => window.api.rerunSetup(featureId))} className="press flex h-8 items-center rounded-lg bg-hover px-3 text-sm">
            Try again
          </button>
        </div>
      )}
      {open && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2.5">
          {lines.map((l, i) => (
            <li key={i} className={clsx('flex items-start gap-2 text-xs', l.startsWith('✗') ? 'text-bad' : l.startsWith('⚠') ? 'text-warn' : 'text-muted')}>
              <span className="mt-px">{l.startsWith('✓') ? '✓' : l.startsWith('✗') ? '✗' : l.startsWith('⚠') ? '!' : '…'}</span>
              <span className="selectable">{l.replace(/^[✓✗…!⚠]\s*/, '')}</span>
            </li>
          ))}
        </ul>
      )}
      {item.status !== 'running' && needsOk && <EnvApproval featureId={featureId} />}
    </div>
  )
}

function StatusCard({ item }: { item: ChatItem }) {
  const lines = item.text.split('\n').filter(Boolean)
  const creator = useIsCreator()
  if (creator && item.id.startsWith('setup-')) return <CreatorSetupCard item={item} lines={lines} />
  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-3',
        item.status === 'error' ? 'border-bad/30 bg-bad/5' : item.status === 'ok' ? 'border-line bg-raised/40' : 'border-line-strong bg-panel'
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
        {item.status === 'running' ? (
          <Spinner className="text-info" />
        ) : item.status === 'ok' ? (
          <Check className="size-4 text-ok" />
        ) : (
          <AlertTriangle className="size-4 text-bad" />
        )}
        {item.status === 'running' ? 'Setting up the workspace' : item.status === 'ok' ? 'Workspace ready' : 'Workspace set up with problems'}
      </div>
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => {
          const pending = l.startsWith('…')
          const bad = l.startsWith('✗')
          const warn = l.startsWith('⚠')
          return (
            <li key={i} className={clsx('flex items-start gap-2 text-sm', bad ? 'text-bad' : warn ? 'text-warn' : pending ? 'text-muted' : 'text-fg/90')}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {pending ? (
                  <CircleDashed className="size-3.5 animate-spin text-faint" />
                ) : bad ? (
                  <X className="size-3.5" />
                ) : warn ? (
                  <AlertTriangle className="size-3.5" />
                ) : (
                  <Check className="size-3.5 text-ok" />
                )}
              </span>
              <span className="selectable">{l.replace(/^[✓✗…!⚠]\s*/, '')}</span>
            </li>
          )
        })}
      </ul>
      {item.status !== 'running' && lines.some((l) => l.includes('haven’t approved')) && <EnvApproval featureId={item.id.split('-')[1]} />}
    </div>
  )
}

/** Approve a change's .spindle commands right from its setup card (works in Creator mode too). */
function EnvApproval({ featureId }: { featureId: string }) {
  const creator = useIsCreator()
  const feature = useStore((s) => s.features.find((f) => f.id === featureId))
  const [env, setEnv] = useState<DevEnvView | null>(null)
  useEffect(() => {
    if (feature?.projectId) void window.api.devEnv(feature.projectId, feature.id).then(setEnv).catch(() => setEnv(null))
  }, [feature?.projectId, feature?.id, feature?.setupStatus])
  if (!feature?.projectId || !env || env.trusted) return null
  return (
    <div className="mt-3">
      <TrustBanner
        simple={creator}
        view={env}
        action={creator ? 'Allow and continue' : 'Approve and run setup'}
        onTrust={async () => {
          const v = await act(() => window.api.trustDevEnv(feature.projectId!, feature.id))
          if (!v) return
          setEnv(v)
          await act(() => window.api.rerunSetup(feature.id))
        }}
      />
    </div>
  )
}

const md = (text: string) => (
  <Markdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            if (href) void window.api.openExternal(href)
          }}
        >
          {children}
        </a>
      )
    }}
  >
    {text}
  </Markdown>
)

const Message = memo(function Message({ item, steps, plan }: { item: ChatItem; steps?: ChatItem[]; plan?: PlanItem[] }) {
  switch (item.role) {
    case 'user':
      return (
        <div className="rise-in flex justify-end">
          <div className="selectable max-w-[85%] rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap shadow-xs">{item.text}</div>
        </div>
      )
    case 'assistant':
      return <div className={clsx('rise-in prose-chat text-fg', item.status === 'running' && 'stream-caret')}>{md(item.text)}</div>
    case 'thinking':
      return <Thinking item={item} />
    case 'tool':
      if (item.tool?.name === 'Task' || item.tool?.name === 'Agent') return <SubagentCard item={item} steps={steps ?? EMPTY} />
      if (plan) return <TodoCard item={item} latest todos={plan} />
      return <ToolRow item={item} />
    case 'error':
      return (
        <div className="selectable flex gap-2.5 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <pre className="font-sans whitespace-pre-wrap">{item.text}</pre>
        </div>
      )
    default:
      if (item.status) return <StatusCard item={item} />
      return (
        <div className="flex items-center gap-3 text-xs text-faint">
          <div className="h-px flex-1 bg-line" />
          <span className="selectable max-w-[80%] text-center">{item.text}</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      )
  }
})

export function ThreadComposer({ feature }: { feature: Feature }) {
  const running = useStore((s) => s.statuses[feature.id]?.running ?? false)
  const waiting = useStore((s) => (s.requests[feature.id]?.length ?? 0) > 0)
  const lastUser = useStore((s) => [...(s.threads[feature.id] ?? EMPTY)].reverse().find((i) => i.role === 'user')?.text)
  const cfg: AgentConfig = {
    agent: feature.agent,
    model: feature.model ?? '',
    effort: feature.effort ?? '',
    permissionMode: feature.permissionMode,
    maxBudgetUsd: feature.maxBudgetUsd
  }
  const onChange = (p: Partial<AgentConfig>) => {
    const patch: Partial<Feature> = { ...p }
    // Sessions can't move between agents, so switching starts fresh.
    if (p.agent && p.agent !== feature.agent) patch.sessionId = undefined
    void act(() => window.api.updateFeature(feature.id, patch))
  }
  if (feature.cleanedUp) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 pb-6 text-center text-sm text-muted">
        This feature shipped and its workspace was cleaned up. Start a new feature to keep building.
      </div>
    )
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      <TurnStatus feature={feature} />
      <Composer
        projectId={feature.projectId}
        cfg={cfg}
        onChange={onChange}
        running={running}
        canQueue={running && feature.agent === 'claude'}
        onStop={() => void act(() => window.api.stopAgent(feature.id))}
        recall={lastUser}
        agentLocked={!!feature.sessionId}
        placeholder={
          waiting
            ? 'Answer above — or type here to add more context'
            : running
              ? feature.agent === 'claude'
                ? 'Add something to the current turn…'
                : 'Codex is working…'
              : feature.kind === 'chat'
              ? 'Ask a follow-up…'
              : `Tell ${feature.agent === 'codex' ? 'Codex' : 'Claude'} what to build or change…`
        }
        onSubmit={(text) => actOk(() => window.api.sendPrompt(feature.id, text))}
        footerRight={feature.costUsd ? <span className="mr-2 text-xs text-faint tabular-nums">${feature.costUsd.toFixed(2)}</span> : null}
      />
    </div>
  )
}

export function Chat({ feature }: { feature: Feature }) {
  const items = useStore((s) => s.threads[feature.id] ?? EMPTY)
  const running = useStore((s) => s.statuses[feature.id]?.running ?? false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    stick.current = true
  }, [feature.id])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, running, feature.id])

  const streaming = items.some((i) => i.status === 'running' && i.role === 'assistant')
  // Subagent steps nest under their Task/Agent card instead of filling the main conversation.
  // The plan (TaskCreate/TaskUpdate/TodoWrite) shows once, as a live checklist at its latest update.
  // Creators see only the latest setup run; earlier runs (before an approval, a retry) are history.
  const creator = useIsCreator()
  const { top, childrenOf, plan } = useMemo(() => {
    const childrenOf = new Map<string, ChatItem[]>()
    const top: ChatItem[] = []
    const plan = planFrom(items)
    const lastSetup = creator ? items.filter((i) => i.id.startsWith('setup-') && i.status).at(-1)?.id : undefined
    for (const it of items) {
      if (lastSetup && it.id.startsWith('setup-') && it.status && it.id !== lastSetup) {
        // superseded setup run
      } else if (it.parentId) {
        const list = childrenOf.get(it.parentId) ?? []
        list.push(it)
        childrenOf.set(it.parentId, list)
      } else if (it.tool?.name === 'ToolSearch') {
        // Claude loading its own tools on demand — harness plumbing, not something to show.
      } else if (!isPlanTool(it) || it.id === plan.anchorId) top.push(it)
    }
    return { top, childrenOf, plan }
  }, [items, creator])
  const waiting = useStore((s) => (s.requests[feature.id]?.length ?? 0) > 0)
  const requestCount = useStore((s) => s.requests[feature.id]?.length ?? 0)
  useLayoutEffect(() => {
    // a new approval/question always scrolls into view
    const el = scroller.current
    if (el && requestCount) el.scrollTop = el.scrollHeight
  }, [requestCount])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {items.length === 0 ? (
          <Empty icon={<MessageSquare className="size-8" />} title={feature.kind === 'chat' ? 'Start the conversation' : 'Describe what to build'}>
            {feature.kind === 'chat'
              ? 'Ask about the codebase, plan an approach, or brainstorm. Continue it as a feature when you are ready to build.'
              : `The agent works on ${feature.branch} in its own worktree.`}
          </Empty>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
            {top.map((it) => (
              <Message key={it.id} item={it} steps={childrenOf.get(it.id)} plan={it.id === plan.anchorId ? plan.todos : undefined} />
            ))}
            <RequestCards featureId={feature.id} />
            {running && !streaming && !waiting && (
              <div className="flex items-center gap-2 text-sm text-faint">
                <Spinner className="text-info" /> <span className="shimmer-text">Working…</span>
              </div>
            )}
          </div>
        )}
      </div>
      <ThreadComposer feature={feature} />
    </div>
  )
}
