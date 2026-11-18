import clsx from 'clsx'
import { ArrowRight, Factory, FolderPlus, GitBranch, MessageSquare, Sparkles, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import type { ThreadKind } from '@shared/types'
import { runAction } from '../lib/actions'
import { useWords } from '../lib/words'
import { ProjectSetupCard } from './OpenProject'
import { act, orderedThreads, useStore } from '../store'
import { Composer, type AgentConfig } from './Composer'
import { MainVersion } from './MainVersion'
import { Kbd, Segmented, Select, timeAgo } from './ui'
import { shortcutFor } from '../lib/shortcuts'

const FEATURE_IDEAS = [
  'Add a CSV export to the invoices page that respects the current filters',
  'Fix the N+1 queries on the dashboard and add a regression test',
  'Add two-factor authentication with TOTP to the login flow'
]
const CHAT_IDEAS = ['How is authentication wired up in this app?', 'Review the database schema and suggest improvements', 'Plan how we could add multi-tenancy']

export function NewThread() {
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const projects = useStore((s) => s.projects)
  const integrations = useStore((s) => s.integrations)
  const openModal = useStore((s) => s.openModal)
  const select = useStore((s) => s.select)
  const features = useStore((s) => s.features)
  // Derive in a memo: a selector returning a fresh array would re-render forever.
  const recent = useMemo(() => orderedThreads({ features, projects }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [features, projects])
  const project = projects.find((p) => p.id === draft.projectId) ?? null
  const isFeature = draft.kind === 'feature'
  const w = useWords()

  const missing = useMemo(() => (integrations ?? []).filter((i) => !i.optional && !i.ready), [integrations])
  const noAgent = integrations && !integrations.some((i) => (i.id === 'claude' || i.id === 'codex') && i.ready)

  const cfg: AgentConfig = { agent: draft.agent, model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode }

  const submit = async (text: string) => {
    if (isFeature && !project) {
      useStore.getState().toast('error', 'Pick a project for the feature, or switch to Chat.')
      return false
    }
    const f = await act(() =>
      window.api.createFeature({
        kind: draft.kind,
        projectId: draft.projectId,
        prompt: text,
        agent: draft.agent,
        model: draft.model,
        effort: draft.effort,
        // chats default to read-only unless the user picked something stronger
        permissionMode: isFeature ? draft.permissionMode : draft.permissionMode === 'acceptEdits' ? 'default' : draft.permissionMode,
        baseBranch: draft.baseBranch || undefined
      })
    )
    if (!f) return false
    await useStore.getState().loadThread(f.id)
    select(f.id)
    return true
  }

  const ideas = isFeature ? FEATURE_IDEAS : CHAT_IDEAS
  // Next to "Start a change": the project's main version, live — point at what should change.
  const showMain = isFeature && !!project && project.setup?.status !== 'running' && project.setup?.status !== 'failed'

  return (
    <div className="flex min-h-0 flex-1">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="drag h-12 shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={clsx('mx-auto flex w-full flex-col gap-6 px-6 pb-12', showMain ? 'max-w-2xl pt-[5vh]' : 'max-w-3xl pt-[8vh]')}>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-raised">
              {isFeature ? <Factory className="size-6 text-accent-strong" /> : <MessageSquare className="size-6 text-accent-strong" />}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{isFeature ? w.whatShouldWeBuild : 'What do you want to talk about?'}</h1>
            <p className="max-w-lg text-base text-muted">
              {showMain
                ? 'Describe it here — or point at things in the live app on the right. Either way it starts in its own safe copy.'
                : isFeature
                ? w.buildHint
                : project
                  ? `Ask anything about ${project.name}. Nothing is changed unless you ask — continue it as a feature when you're ready.`
                  : 'A general conversation, not tied to any project.'}
            </p>
          </div>

          {(missing.length > 0 || noAgent) && (
            <button
              type="button"
              onClick={() => openModal({ kind: 'settings', tab: 'integrations' })}
              className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-left text-sm text-warn hover:bg-warn/15"
            >
              <TriangleAlert className="size-5 shrink-0" />
              <span className="flex-1">
                {noAgent ? 'Set up Claude Code or Codex to get started.' : `Finish setting up ${missing.map((m) => m.name).join(' and ')}.`}
              </span>
              <span className="flex items-center gap-1 font-medium">
                Set up <ArrowRight className="size-4" />
              </span>
            </button>
          )}

          {project && <ProjectSetupCard project={project} />}

          <Composer
            big
            cfg={cfg}
            onChange={(p) => setDraft(p)}
            onSubmit={submit}
            placeholder={isFeature ? 'Describe the feature…' : 'Ask anything…'}
            header={
              <>
                <Segmented<ThreadKind>
                  size="sm"
                  value={draft.kind}
                  onChange={(kind) => setDraft({ kind })}
                  options={[
                    { value: 'feature', label: <><GitBranch className="size-3.5" /> {w.feature}</>, title: `New feature  ${shortcutFor('new-feature')?.join('')}` },
                    { value: 'chat', label: <><MessageSquare className="size-3.5" /> Chat</>, title: `New chat  ${shortcutFor('new-chat')?.join('')}` }
                  ]}
                />
                <Select
                  aria-label="Project"
                  value={draft.projectId ?? ''}
                  onChange={(e) => {
                    if (e.target.value === '__add') return void runAction('add-project')
                    setDraft({ projectId: e.target.value || null })
                  }}
                  className="h-8 max-w-[220px] border-transparent bg-transparent text-sm hover:bg-hover"
                >
                  {!isFeature && <option value="">No project</option>}
                  {isFeature && !project && <option value="">Choose a project…</option>}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="__add">+ Open project…</option>
                </Select>
                {isFeature && project && (
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-xs text-faint">
                    <GitBranch className="size-3.5" /> from
                    <input
                      aria-label="Base branch"
                      value={draft.baseBranch}
                      onChange={(e) => setDraft({ baseBranch: e.target.value })}
                      placeholder={project.defaultBranch}
                      className="w-24 rounded-md bg-transparent px-1.5 py-0.5 text-muted outline-none placeholder:text-faint hover:bg-hover focus:bg-hover"
                    />
                  </span>
                )}
              </>
            }
          />

          {projects.length === 0 && (
            <button
              type="button"
              onClick={() => void runAction('add-project')}
              className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3 text-left text-sm text-muted hover:border-accent/50 hover:text-fg"
            >
              <FolderPlus className="size-5 text-accent-strong" />
              <span className="flex-1">Open a project from GitHub, a folder on this Mac, or start a new Laravel app. Plain chats work without one.</span>
              <Kbd keys={shortcutFor('add-project')} />
            </button>
          )}

          <div className="flex flex-wrap justify-center gap-2">
            {ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => {
                  const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
                  if (!ta) return
                  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
                  setter?.call(ta, idea)
                  ta.dispatchEvent(new Event('input', { bubbles: true }))
                  ta.focus()
                }}
                className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-1.5 text-sm text-muted hover:border-line-strong hover:text-fg"
              >
                <Sparkles className="size-3.5 text-accent-strong" />
                {idea}
              </button>
            ))}
          </div>

          {recent.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold tracking-wider text-faint uppercase">Recent</span>
                <span className="flex items-center gap-1.5 text-xs text-faint">
                  Jump with <Kbd keys={['⌘', '1–9']} /> or <Kbd keys={shortcutFor('palette')} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {recent.map((f) => {
                  const p = projects.find((x) => x.id === f.projectId)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => select(f.id)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised"
                    >
                      {f.kind === 'chat' ? <MessageSquare className="size-4 text-faint" /> : <GitBranch className="size-4 text-faint" />}
                      <span className="min-w-0 flex-1 truncate text-base">{f.title}</span>
                      <span className={clsx('shrink-0 text-sm text-faint')}>{p?.name ?? 'Chat'}</span>
                      <span className="w-20 shrink-0 text-right text-sm text-faint">{timeAgo(f.updatedAt)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    {showMain && (
      <div className="flex w-[52%] max-w-[980px] min-w-[420px] shrink-0 flex-col border-l border-line bg-panel">
        <div className="drag h-12 shrink-0 border-b border-line" />
        <div className="min-h-0 flex-1">
          <MainVersion key={project!.id} project={project!} agent={{ agent: draft.agent, model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode, baseBranch: draft.baseBranch }} />
        </div>
      </div>
    )}
    </div>
  )
}
