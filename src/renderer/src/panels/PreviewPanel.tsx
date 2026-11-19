import { Globe, Link2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Feature, Project } from '@shared/types'
import { LivePreview } from '../components/LivePreview'
import { Button, Empty, IconButton } from '../components/ui'
import { act, actOk, useStore } from '../store'

/** A change's live preview: its own site, with "point at something to change" sending to its agent. */
export function PreviewPanel({ feature, project, active = true }: { feature: Feature; project: Project; active?: boolean }) {
  const [linking, setLinking] = useState(false)
  const running = useStore((s) => s.statuses[feature.id]?.running ?? false)
  // Bumps when the agent finishes a turn → "New changes — reload" (never a forced reload).
  const [finishedTurns, setFinishedTurns] = useState(0)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) setFinishedTurns((n) => n + 1)
    wasRunning.current = running
  }, [running])
  const [tipHidden, setTipHidden] = useState(() => {
    try {
      return localStorage.getItem('sf.previewTip') === 'hidden'
    } catch {
      return false
    }
  })
  const hideTip = () => {
    setTipHidden(true)
    try {
      localStorage.setItem('sf.previewTip', 'hidden')
    } catch {
      /* fine */
    }
  }

  if (!feature.localUrl) {
    return (
      <Empty icon={<Globe className="size-8" />} title="No preview yet">
        {project.herdEnabled || project.server !== 'herd' ? (
          <>
            This change doesn&apos;t have a local preview site yet.
            <div className="mt-3">
              <Button
                size="sm"
                variant="primary"
                icon={<Link2 className="size-4" />}
                loading={linking}
                onClick={async () => {
                  setLinking(true)
                  await act(() => window.api.herdLink(feature.id), 'Preview ready')
                  setLinking(false)
                }}
              >
                Start preview
              </Button>
            </div>
          </>
        ) : (
          'Turn on “Its own local site in Herd” in project settings to preview each change.'
        )}
      </Empty>
    )
  }

  return (
    <LivePreview
      notesKey={feature.id}
      url={feature.localUrl}
      partition={`persist:herd-${feature.herdSite ?? feature.slug}`}
      auth={project.isLaravel ? { featureId: feature.id } : undefined}
      active={active}
      staleSignal={finishedTurns}
      intro="Please make these visual changes in the running app"
      sendLabel="Send to AI"
      onSend={async (prompt, attachments, comments) => {
        const ok = await actOk(() => window.api.sendPrompt(feature.id, prompt, attachments))
        if (ok) {
          for (const c of comments) void window.api.addVisualNote(feature.id, c)
          useStore.getState().toast('success', `Sent ${comments.length} change request${comments.length > 1 ? 's' : ''} to the AI`)
        }
        return ok
      }}
      onFixErrors={(prompt) => void act(() => window.api.sendPrompt(feature.id, prompt), 'Sent to the AI')}
      banner={
        !tipHidden && (
          <div className="flex items-center gap-3 border-b border-line bg-raised/60 px-3 py-2 text-xs text-muted">
            <span className="shrink-0 font-semibold text-fg">How to test</span>
            <span className="min-w-0 truncate">
              <b className="text-fg">1</b> Click around like a user would · <b className="text-fg">2</b> Something off? Point at it, or tell the AI in the chat ·{' '}
              <b className="text-fg">3</b> Happy with it?
            </span>
            <button type="button" onClick={() => useStore.getState().setRightTab('ship')} className="shrink-0 font-semibold text-info hover:underline">
              Check &amp; submit →
            </button>
            <div className="flex-1" />
            <IconButton title="Got it — hide this tip" className="size-6" onClick={hideTip}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        )
      }
    />
  )
}
