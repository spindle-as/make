import clsx from 'clsx'
import { Check, CircleHelp, ClipboardList, Hand, ShieldCheck, X } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PendingRequest } from '@shared/types'
import { act, useStore } from '../store'
import { Button, Kbd } from './ui'

const EMPTY: PendingRequest[] = []

function PermissionCard({ req, focus }: { req: PendingRequest; focus: boolean }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus()
  }, [focus])

  const decide = async (decision: 'allow' | 'allow-always' | 'deny') => {
    setBusy(true)
    await act(() => window.api.respondPermission(req.featureId, req.id, decision, decision === 'deny' ? note : undefined))
    setBusy(false)
  }
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      if (e.key === 'Enter') {
        e.preventDefault()
        void decide('deny')
      }
      return
    }
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault()
      void decide('allow-always')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void decide('allow')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      void decide('deny')
    }
  }
  const isCommand = req.toolName === 'Bash'
  return (
    <div
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKey}
      role="alertdialog"
      data-request-card
      aria-label={`${req.title}: ${req.detail}`}
      className="pop-in rounded-2xl border border-warn/40 bg-warn/[0.06] p-4 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-warn/60"
    >
      <div className="mb-2 flex items-center gap-2 text-base font-medium">
        <Hand className="size-5 text-warn" />
        {req.title}
        <span className="text-sm font-normal text-faint">· needs your approval</span>
      </div>
      {req.detail && (
        <pre className={clsx('selectable mb-3 max-h-56 overflow-auto rounded-lg bg-bg px-3 py-2 text-sm whitespace-pre-wrap', isCommand ? 'font-mono text-fg' : 'font-mono text-muted')}>
          {isCommand ? `$ ${req.detail}` : req.detail}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={busy} icon={<Check className="size-4" />} onClick={() => decide('allow')}>
          Allow <Kbd keys={['↵']} className="ml-1" />
        </Button>
        <Button icon={<ShieldCheck className="size-4" />} onClick={() => decide('allow-always')} disabled={busy} title="Allow this kind of action for the rest of this thread">
          Always allow <Kbd keys={['⌥', '↵']} className="ml-1" />
        </Button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="…or tell it what to do instead"
          aria-label="Tell the agent what to do instead"
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-line-strong bg-bg/60 px-3 text-sm outline-none placeholder:text-faint focus:border-info/60"
        />
        <Button variant="ghost" icon={<X className="size-4" />} onClick={() => decide('deny')} disabled={busy}>
          Decline <Kbd keys={['Esc']} className="ml-1" />
        </Button>
      </div>
    </div>
  )
}

/** Claude finished planning (ExitPlanMode): show the plan itself and let the user decide how to go on. */
function PlanCard({ req, focus }: { req: PendingRequest; focus: boolean }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus()
  }, [focus])
  const plan = typeof req.input.plan === 'string' ? req.input.plan : req.detail
  const decide = async (decision: 'approve-plan' | 'allow' | 'deny') => {
    setBusy(true)
    await act(() => window.api.respondPermission(req.featureId, req.id, decision, decision === 'deny' ? note || 'Keep planning — the plan needs changes.' : undefined))
    setBusy(false)
  }
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-request-card
      role="alertdialog"
      aria-label="The plan is ready for review"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') {
          if (e.key === 'Enter') {
            e.preventDefault()
            void decide('deny')
          }
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          void decide('approve-plan')
        }
      }}
      className="pop-in rounded-2xl border border-info/35 bg-info/[0.05] p-4 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-info/50"
    >
      <div className="mb-2 flex items-center gap-2 text-base font-medium">
        <ClipboardList className="size-5 text-info" /> The plan is ready
        <span className="text-sm font-normal text-faint">· review it before anything changes</span>
      </div>
      <div className="prose-chat selectable mb-3 max-h-[420px] overflow-y-auto rounded-xl border border-line bg-bg px-4 py-3 text-sm">
        <Markdown remarkPlugins={[remarkGfm]}>{plan}</Markdown>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={busy} icon={<Check className="size-4" />} onClick={() => decide('approve-plan')} title="Leave plan mode and build it, editing files without asking">
          Approve &amp; build <Kbd keys={['↵']} className="ml-1" />
        </Button>
        <Button onClick={() => decide('allow')} disabled={busy} title="Leave plan mode, but ask before each edit">
          Approve, ask before edits
        </Button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="…or say what to change in the plan"
          aria-label="What to change in the plan"
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-line-strong bg-bg/60 px-3 text-sm outline-none placeholder:text-faint focus:border-info/60"
        />
        <Button variant="ghost" icon={<X className="size-4" />} onClick={() => decide('deny')} disabled={busy}>
          Keep planning
        </Button>
      </div>
    </div>
  )
}

function QuestionCard({ req, focus }: { req: PendingRequest; focus: boolean }) {
  const questions = req.questions ?? []
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus()
  }, [focus])

  const toggle = (q: string, label: string, multi: boolean) => {
    const cur = picked[q] ?? []
    setPicked({ ...picked, [q]: multi ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label] })
    if (!multi) setOther({ ...other, [q]: '' })
  }
  const answerFor = (q: string) => (other[q]?.trim() ? other[q].trim() : (picked[q] ?? []).join(', '))
  const complete = questions.every((q) => answerFor(q.question))

  const submit = async () => {
    if (!complete) return
    setBusy(true)
    await act(() => window.api.answerQuestion(req.featureId, req.id, Object.fromEntries(questions.map((q) => [q.question, answerFor(q.question)]))))
    setBusy(false)
  }
  const onKey = (e: KeyboardEvent) => {
    const inInput = (e.target as HTMLElement).tagName === 'INPUT'
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (!inInput && /^[1-9]$/.test(e.key) && questions.length === 1) {
      // number keys pick options of a single question
      const q = questions[0]
      const opt = q.options[Number(e.key) - 1]
      if (opt) toggle(q.question, opt.label, q.multiSelect)
    }
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKey}
      role="dialog"
      data-request-card
      aria-label="The agent has a question"
      className="pop-in rounded-2xl border border-info/35 bg-info/[0.05] p-4 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-info/50"
    >
      <div className="mb-3 flex items-center gap-2 text-base font-medium">
        <CircleHelp className="size-5 text-fg" />
        {questions.length > 1 ? 'A few questions before continuing' : 'A question before continuing'}
      </div>
      <div className="flex flex-col gap-4">
        {questions.map((q) => (
          <fieldset key={q.question}>
            <legend className="mb-2 text-base text-fg">
              {q.header && <span className="mr-2 rounded bg-hover px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-muted uppercase">{q.header}</span>}
              {q.question}
              {q.multiSelect && <span className="ml-2 text-sm text-faint">(pick any)</span>}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((o, i) => {
                const on = (picked[q.question] ?? []).includes(o.label) && !other[q.question]?.trim()
                return (
                  <button
                    key={o.label}
                    type="button"
                    role={q.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => toggle(q.question, o.label, q.multiSelect)}
                    className={clsx(
                      'flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      on ? 'border-fg/60 bg-active' : 'border-line-strong bg-panel hover:border-fg/30'
                    )}
                  >
                    {questions.length === 1 && <Kbd keys={[String(i + 1)]} className="mt-0.5" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{o.label}</span>
                      {o.description && <span className="block text-xs text-muted">{o.description}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
            <input
              value={other[q.question] ?? ''}
              onChange={(e) => setOther({ ...other, [q.question]: e.target.value })}
              placeholder="Something else…"
              aria-label={`Other answer to: ${q.question}`}
              className="mt-2 h-9 w-full rounded-lg border border-line-strong bg-bg/60 px-3 text-sm outline-none placeholder:text-faint focus:border-info/60"
            />
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="primary" onClick={submit} disabled={!complete} loading={busy}>
          Answer <Kbd keys={['↵']} className="ml-1" />
        </Button>
      </div>
    </div>
  )
}

/** Pending approvals and questions for a thread; the newest one takes keyboard focus. */
export function RequestCards({ featureId }: { featureId: string }) {
  const requests = useStore((s) => s.requests[featureId] ?? EMPTY)
  if (!requests.length) return null
  const last = requests[requests.length - 1].id
  return (
    <div className="flex flex-col gap-3">
      {requests.map((r) =>
        r.kind === 'question' ? (
          <QuestionCard key={r.id} req={r} focus={r.id === last} />
        ) : r.toolName === 'ExitPlanMode' ? (
          <PlanCard key={r.id} req={r} focus={r.id === last} />
        ) : (
          <PermissionCard key={r.id} req={r} focus={r.id === last} />
        )
      )}
    </div>
  )
}
