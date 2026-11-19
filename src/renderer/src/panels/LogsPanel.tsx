import clsx from 'clsx'
import { Activity, ExternalLink, RefreshCw, Trash2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lastErrors, levelOf } from '@shared/laravelLog'
import type { Environment, Feature, McpStatus, Project } from '@shared/types'
import { Badge, Button, Empty, IconButton, Select, Spinner, Toggle } from '../components/ui'
import { act, useStore } from '../store'

type Source = { kind: 'local' } | { kind: 'remote'; env: Environment } | { kind: 'nightwatch'; env?: Environment }

function LogView({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])
  const lines = useMemo(() => text.split('\n'), [text])
  let current: ReturnType<typeof levelOf> = null
  return (
    <div ref={ref} className="selectable h-full overflow-auto bg-bg px-3 py-2 font-mono text-xs leading-[1.5]">
      {lines.map((l, i) => {
        const lvl = levelOf(l)
        if (lvl) current = lvl
        return (
          <div
            key={i}
            className={clsx(
              'whitespace-pre-wrap',
              lvl ? 'mt-1' : '',
              current === 'error' && (lvl ? 'text-bad' : 'text-bad/70'),
              current === 'warn' && 'text-warn',
              current === 'debug' && 'text-faint',
              (current === 'info' || current === null) && 'text-muted',
              l.startsWith('# ') && 'text-faint'
            )}
          >
            {l || ' '}
          </div>
        )
      })}
    </div>
  )
}

function NightwatchView({ feature, project, env }: { feature: Feature; project: Project; env?: Environment }) {
  const [mcp, setMcp] = useState<McpStatus[] | null>(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => setMcp((await act(() => window.api.mcpStatus())) ?? []), [])
  useEffect(() => {
    void load()
  }, [load])
  const installed = mcp?.find((m) => m.name === 'nightwatch' && m.agent === feature.agent)?.installed

  const triage = () =>
    act(
      () =>
        window.api.sendPrompt(
          feature.id,
          `Use the Nightwatch MCP tools to look at the open issues (exceptions and performance issues) for the ${env?.name ?? 'production'} environment of the "${project.name}" application. List the most important ones with occurrence counts, pick the most impactful one, read its stack trace and code context, find the root cause in this codebase, and fix it with a regression test. Summarise what you found and what you changed.`
        ),
      'Sent triage request to the agent'
    )

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3 text-xs text-muted">
        <div className="mb-2 flex items-center gap-2">
          <Activity className="size-4 text-fg" />
          <span className="text-sm font-medium text-fg">Laravel Nightwatch</span>
          {mcp === null ? <Spinner /> : installed ? <Badge tone="ok">MCP connected</Badge> : <Badge tone="warn">MCP not set up</Badge>}
        </div>
        <p className="mb-3 leading-relaxed">
          Nightwatch exposes production issues to agents through its MCP server. The agent can list exceptions, read stack traces and fix them in
          this branch.
        </p>
        <div className="flex flex-wrap gap-2">
          {!installed && mcp !== null && (
            <Button
              size="sm"
              loading={busy === 'install'}
              onClick={async () => {
                setBusy('install')
                const msg = await act(() => window.api.installMcp('nightwatch', feature.agent))
                setBusy('')
                if (msg) useStore.getState().toast('success', msg)
                void load()
              }}
            >
              Add Nightwatch MCP to {feature.agent === 'codex' ? 'Codex' : 'Claude Code'}
            </Button>
          )}
          <Button size="sm" variant="primary" icon={<Wand2 className="size-4" />} onClick={triage} disabled={!installed}>
            Triage & fix top issue
          </Button>
          {env?.nightwatchUrl && (
            <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => void window.api.openExternal(env.nightwatchUrl!)}>
              Open dashboard
            </Button>
          )}
        </div>
        {!installed && mcp !== null && (
          <p className="mt-2 text-xs text-faint">
            After adding it, authenticate once: run <code className="font-mono">{feature.agent === 'codex' ? 'codex mcp login nightwatch' : 'claude → /mcp'}</code> in a terminal.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {env?.nightwatchUrl ? (
          <webview src={env.nightwatchUrl} partition="persist:nightwatch" />
        ) : (
          <Empty title="No dashboard URL">Set a Nightwatch URL on an environment in project settings to embed the dashboard here.</Empty>
        )}
      </div>
    </div>
  )
}

export function LogsPanel({ feature, project }: { feature: Feature; project: Project }) {
  const [sourceKey, setSourceKey] = useState('local')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(true)
  const [lines, setLines] = useState(300)

  const sources: { key: string; label: string; source: Source }[] = useMemo(
    () => [
      { key: 'local', label: 'Local (worktree)', source: { kind: 'local' } },
      ...project.environments
        .filter((e) => e.sshTarget && e.remotePath)
        .map((e) => ({ key: `remote:${e.id}`, label: `${e.name} (ssh)`, source: { kind: 'remote' as const, env: e } })),
      ...(project.environments.length
        ? project.environments.map((e) => ({ key: `nw:${e.id}`, label: `Nightwatch · ${e.name}`, source: { kind: 'nightwatch' as const, env: e } }))
        : [{ key: 'nw', label: 'Nightwatch', source: { kind: 'nightwatch' as const } }])
    ],
    [project.environments]
  )
  const current = sources.find((s) => s.key === sourceKey)?.source ?? sources[0].source

  const load = useCallback(async () => {
    if (current.kind === 'nightwatch') return
    setLoading(true)
    try {
      const t =
        current.kind === 'local'
          ? await window.api.readLocalLog(feature.id, lines)
          : await window.api.readRemoteLog(project.id, current.env.id, lines)
      setText(t)
    } catch (e) {
      setText(`# ${(e as Error).message}`)
    }
    setLoading(false)
  }, [current, feature.id, project.id, lines])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!auto || current.kind === 'nightwatch') return
    const t = setInterval(load, current.kind === 'local' ? 3000 : 15000)
    return () => clearInterval(t)
  }, [auto, load, current.kind])

  const errors = useMemo(() => lastErrors(text, 3), [text])

  const sendErrors = () =>
    act(
      () =>
        window.api.sendPrompt(
          feature.id,
          `These errors appeared in the ${current.kind === 'local' ? 'local' : current.kind === 'remote' ? current.env.name : ''} Laravel log. Find the root cause and fix it:\n\n\`\`\`\n${errors.join('\n\n')}\n\`\`\``
        ),
      'Sent errors to the agent'
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} className="h-7 text-xs">
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        {current.kind !== 'nightwatch' && (
          <>
            <Select value={lines} onChange={(e) => setLines(Number(e.target.value))} className="h-7 text-xs">
              {[100, 300, 1000, 3000].map((n) => (
                <option key={n} value={n}>
                  {n} lines
                </option>
              ))}
            </Select>
            <Toggle checked={auto} onChange={setAuto} label={<span className="text-xs text-muted">Live</span>} />
            <div className="flex-1" />
            {errors.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Wand2 className="size-4" />} onClick={sendErrors}>
                Fix {errors.length} error{errors.length > 1 ? 's' : ''}
              </Button>
            )}
            {current.kind === 'local' && (
              <IconButton
                title="Clear local log"
                onClick={async () => {
                  await act(() => window.api.clearLocalLog(feature.id))
                  void load()
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            )}
            <IconButton title="Refresh" onClick={load}>
              {loading ? <Spinner /> : <RefreshCw className="size-4" />}
            </IconButton>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {current.kind === 'nightwatch' ? (
          <NightwatchView feature={feature} project={project} env={current.env} />
        ) : (
          <LogView text={text} />
        )}
      </div>
    </div>
  )
}
