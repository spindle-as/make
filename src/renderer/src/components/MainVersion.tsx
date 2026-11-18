import { AlertTriangle, CheckCircle2, GitBranch, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { MainSiteState, PermissionMode, Project } from '@shared/types'
import { act, useStore } from '../store'
import { LivePreview } from './LivePreview'
import { IconButton, Spinner } from './ui'

/** What's typed in the "Start a change" box goes along as context (and is cleared once used). */
function takeComposerText(): string {
  const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
  const text = ta?.value.trim() ?? ''
  if (ta && text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, '')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return text
}

/**
 * The project's main version, live and current: browse it, point at what should change, and those
 * notes (with screenshots) start a new change in its own workspace.
 */
export function MainVersion({
  project,
  agent
}: {
  project: Project
  agent: { agent: 'claude' | 'codex'; model: string; effort: string; permissionMode: PermissionMode; baseBranch: string }
}) {
  const [state, setState] = useState<MainSiteState | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [updates, setUpdates] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const s = await window.api.mainSite(project.id)
      setState(s)
      if (s.updated) setUpdates((n) => n + 1)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    setState(null)
    void load()
  }, [load])
  // Dependencies/assets finished refreshing after an update → offer a reload.
  useEffect(
    () =>
      window.api.on('main:updated', ({ projectId }) => {
        if (projectId === project.id) {
          setUpdates((n) => n + 1)
          void load()
        }
      }),
    [project.id, load]
  )

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
        <AlertTriangle className="size-6 text-warn" />
        <div>The main version couldn’t start: {error}</div>
        <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => void load()}>
          Try again
        </button>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Starting the main version of {project.name}…
      </div>
    )
  }
  if (!state.url) {
    return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">This project has no local site yet — finish its setup first.</div>
  }

  return (
    <LivePreview
      notesKey={`main:${project.id}`}
      url={state.url}
      partition={`persist:main-${project.slug}`}
      staleSignal={updates}
      intro="Start a new change from the current version of the app. Make these changes"
      sendLabel="Start a change"
      sendHint="— all of them become one new change in its own workspace"
      banner={
        <div className="flex items-center gap-2 border-b border-line bg-raised/40 px-3 py-1.5 text-xs text-muted">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium text-fg">Main version</span>
          <span className="shrink-0 font-mono">{state.branch}</span>
          {state.note ? (
            <span className="flex min-w-0 items-center gap-1 text-warn">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="truncate">{state.note}</span>
            </span>
          ) : state.refreshing ? (
            <span className="flex items-center gap-1.5">
              <Spinner /> Updating dependencies…
            </span>
          ) : (
            <span className="flex items-center gap-1 text-ok">
              <CheckCircle2 className="size-3.5" /> {state.updated ? `just pulled ${state.updated} update${state.updated > 1 ? 's' : ''}` : 'up to date'}
            </span>
          )}
          <div className="flex-1" />
          <span className="hidden truncate text-faint xl:inline">Point at what should change — each note starts the change with a screenshot.</span>
          <IconButton title="Check for updates and reload" className="size-7" onClick={() => void load()}>
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </IconButton>
        </div>
      }
      onSend={async (prompt, attachments, comments) => {
        const context = takeComposerText()
        // Named after what you asked for (also the branch name), not the request boilerplate.
        const first = (context || comments[0]).split('\n')[0].replace(/[.!?]+$/, '')
        const title = (first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first) + (!context && comments.length > 1 ? ` (+${comments.length - 1} more)` : '')
        const f = await act(() =>
          window.api.createFeature({
            kind: 'feature',
            projectId: project.id,
            title,
            prompt: context ? `${context}\n\n${prompt}` : prompt,
            attachments,
            agent: agent.agent,
            model: agent.model,
            effort: agent.effort,
            permissionMode: agent.permissionMode,
            baseBranch: agent.baseBranch || undefined
          })
        )
        if (!f) return false
        await useStore.getState().loadThread(f.id)
        useStore.getState().select(f.id)
        return true
      }}
    />
  )
}
