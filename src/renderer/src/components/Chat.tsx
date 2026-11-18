import clsx from 'clsx'
import {
  AlertTriangle,
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
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatItem, DevEnvView, Feature } from '@shared/types'
import { act, actOk, useStore } from '../store'
import { Composer, type AgentConfig } from './Composer'
import { TrustBanner } from './DevEnvEditor'
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
          <Spinner className="text-accent-strong" />
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
function StatusCard({ item }: { item: ChatItem }) {
  const lines = item.text.split('\n').filter(Boolean)
  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-3',
        item.status === 'error' ? 'border-bad/30 bg-bad/5' : item.status === 'ok' ? 'border-ok/25 bg-ok/5' : 'border-line-strong bg-panel'
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
        {item.status === 'running' ? (
          <Spinner className="text-accent-strong" />
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
  const feature = useStore((s) => s.features.find((f) => f.id === featureId))
  const [env, setEnv] = useState<DevEnvView | null>(null)
  useEffect(() => {
    if (feature?.projectId) void window.api.devEnv(feature.projectId, feature.id).then(setEnv).catch(() => setEnv(null))
  }, [feature?.projectId, feature?.id, feature?.setupStatus])
  if (!feature?.projectId || !env || env.trusted) return null
  return (
    <div className="mt-3">
      <TrustBanner
        view={env}
        action="Approve and run setup"
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

const Message = memo(function Message({ item }: { item: ChatItem }) {
  switch (item.role) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="selectable max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap">{item.text}</div>
        </div>
      )
    case 'assistant':
      return <div className={clsx('prose-chat text-fg', item.status === 'running' && 'stream-caret')}>{md(item.text)}</div>
    case 'thinking':
      return <Thinking item={item} />
    case 'tool':
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
      <Composer
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
            {items.map((it) => (
              <Message key={it.id} item={it} />
            ))}
            <RequestCards featureId={feature.id} />
            {running && !streaming && !waiting && (
              <div className="flex items-center gap-2 text-sm text-faint">
                <Spinner className="text-accent-strong" /> Working…
              </div>
            )}
          </div>
        )}
      </div>
      <ThreadComposer feature={feature} />
    </div>
  )
}
