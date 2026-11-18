import clsx from 'clsx'
import { ArrowRight, Check, Code2, FolderOpen, Palette } from 'lucide-react'
import type { Settings } from '@shared/types'
import { act, useStore } from '../store'
import { Lockup, PoweredBy } from './Brand'
import { IntegrationsList } from './Integrations'
import { ProjectSetupCard } from './OpenProject'
import { Button } from './ui'

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-4">
      <span className={clsx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold', done ? 'bg-accent text-ink' : 'bg-hover text-fg')}>
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </section>
  )
}

/** First run: choose the experience, get tools ready, open a project — then start building. */
export function Onboarding() {
  const settings = useStore((s) => s.settings)
  const integrations = useStore((s) => s.integrations)
  const projects = useStore((s) => s.projects)
  const setSettings = useStore((s) => s.setSettings)
  const openModal = useStore((s) => s.openModal)
  const agentReady = !!integrations?.some((i) => (i.id === 'claude' || i.id === 'codex') && i.ready)
  const github = integrations?.find((i) => i.id === 'github')
  const latest = [...projects].sort((a, b) => b.createdAt - a.createdAt)[0]
  const projectReady = !!latest && (!latest.setup || latest.setup.status === 'done')

  const save = async (patch: Partial<Settings>) => {
    const s = await act(() => window.api.saveSettings(patch))
    if (s) setSettings(s)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-12 shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 pt-4 pb-16">
          <div className="flex flex-col items-center gap-4 text-center">
            <Lockup height={72} />
            <div className="text-xl font-medium tracking-tight">
              <span className="text-faint">/</span> make
            </div>
            <p className="max-w-lg text-base text-muted">
              Describe what you want, watch it get built, try it, and submit it for review. No terminals, no setup — one app from idea to pull request.
            </p>
          </div>

          <Step n={1} title="How will you use Spindle?" done={!!settings}>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { mode: 'creator', icon: <Palette className="size-5" />, title: 'Creator', text: 'Describe changes, preview them and submit for review. Technical details stay out of the way.' },
                  { mode: 'developer', icon: <Code2 className="size-5" />, title: 'Developer', text: 'Everything a professional needs: code, branches, processes, databases, deploys.' }
                ] as const
              ).map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => void save({ mode: o.mode })}
                  className={clsx(
                    'flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors',
                    settings?.mode === o.mode ? 'border-accent bg-accent/10' : 'border-line-strong bg-panel hover:border-accent/50'
                  )}
                >
                  <span className={clsx('flex items-center gap-2 text-base font-medium', settings?.mode === o.mode && 'text-accent')}>
                    {o.icon} {o.title}
                  </span>
                  <span className="text-sm text-muted">{o.text}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-faint">You can switch any time with ⇧⌘D.</p>
          </Step>

          <Step n={2} title="Your tools" done={agentReady && !!github?.ready}>
            <p className="mb-3 text-sm text-muted">Detected automatically. You need an AI agent and GitHub; everything else is optional.</p>
            <IntegrationsList compact />
          </Step>

          <Step n={3} title="Open your project" done={projectReady}>
            {latest ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="size-4 text-ok" /> {latest.name}
                  <Button size="sm" variant="ghost" onClick={() => openModal({ kind: 'open-project' })}>
                    Open another
                  </Button>
                </div>
                <ProjectSetupCard project={latest} />
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted">From GitHub, a folder on this Mac, or a brand-new Laravel app. Spindle sets it up for you.</p>
                <Button size="lg" variant="primary" icon={<FolderOpen className="size-5" />} onClick={() => openModal({ kind: 'open-project' })}>
                  Open a project
                </Button>
              </>
            )}
          </Step>

          <Step n={4} title="Start building">
            <p className="mb-4 text-sm text-muted">
              {settings?.mode === 'developer' ? 'Describe a feature and an agent builds it in its own workspace.' : 'Describe what you’d like to create or change, in your own words.'}
            </p>
            <div className="flex items-center gap-3">
              <Button size="lg" variant="primary" onClick={() => void save({ onboarded: true })} disabled={!agentReady}>
                Start building <ArrowRight className="size-5" />
              </Button>
              <Button variant="ghost" onClick={() => void save({ onboarded: true })}>
                Skip for now
              </Button>
              {!agentReady && <span className="text-sm text-warn">Set up Claude Code or Codex first.</span>}
            </div>
          </Step>

          <PoweredBy className="justify-center" />
        </div>
      </div>
    </div>
  )
}
