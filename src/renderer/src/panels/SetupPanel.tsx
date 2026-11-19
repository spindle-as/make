import { FileCode2, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DevEnvView, Feature } from '@shared/types'
import { TrustBanner } from '../components/DevEnvEditor'
import { Badge, Button } from '../components/ui'
import { act, useStore } from '../store'

export function SetupPanel({ feature }: { feature: Feature }) {
  const ref = useRef<HTMLPreElement>(null)
  const [busy, setBusy] = useState(false)
  const [env, setEnv] = useState<DevEnvView | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [feature.setupLog])
  // Which .spindle config this change runs with (its branch's copy), and whether it's approved.
  useEffect(() => {
    if (!feature.projectId || feature.kind !== 'feature') return
    void window.api.devEnv(feature.projectId, feature.id).then(setEnv).catch(() => setEnv(null))
  }, [feature.projectId, feature.id, feature.kind, feature.setupStatus])
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
        <span className="font-medium">Worktree setup</span>
        <Badge tone={feature.setupStatus === 'ok' ? 'ok' : feature.setupStatus === 'failed' ? 'bad' : 'warn'}>
          {feature.setupStatus ?? 'pending'}
        </Badge>
        <span className="truncate font-mono text-xs text-faint">{feature.worktreePath}</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCw className="size-3.5" />}
          loading={busy || feature.setupStatus === 'running'}
          onClick={async () => {
            setBusy(true)
            await act(() => window.api.rerunSetup(feature.id))
            setBusy(false)
          }}
        >
          Re-run
        </Button>
      </div>
      {env && (
        <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <FileCode2 className="size-3.5" />
            <span>
              {env.source === 'file' ? 'Runs with this branch’s .spindle/config.json' : 'No .spindle/config.json — using detected settings'}
              {env.runtime.php && ` · PHP ${env.runtime.php.version}`}
              {env.runtime.node && ` · Node ${env.runtime.node.version}`}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              className="text-info hover:underline"
              onClick={() => useStore.getState().openModal({ kind: 'project', projectId: feature.projectId!, tab: 'environment' })}
            >
              Edit environment
            </button>
          </div>
          <TrustBanner
            view={env}
            action="Approve and run setup"
            onTrust={async () => {
              const v = await act(() => window.api.trustDevEnv(feature.projectId!, feature.id))
              if (!v) return
              setEnv(v)
              setBusy(true)
              await act(() => window.api.rerunSetup(feature.id))
              setBusy(false)
            }}
          />
        </div>
      )}
      <pre ref={ref} className="selectable min-h-0 flex-1 overflow-auto bg-bg px-3 py-2 font-mono text-xs leading-[1.5] whitespace-pre-wrap text-muted">
        {feature.setupLog || 'No setup output yet.'}
      </pre>
    </div>
  )
}
