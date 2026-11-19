import clsx from 'clsx'
import { CornerDownLeft, Play, RotateCw, Square, Terminal, Trash2, Wand2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, ProcessInfo, Project, ServiceDef } from '@shared/types'
import { Badge, Button, Empty, IconButton } from '../components/ui'
import { act, useStore } from '../store'

function statusTone(p?: ProcessInfo): 'ok' | 'bad' | 'neutral' | 'warn' {
  if (!p) return 'neutral'
  if (p.status === 'running') return 'ok'
  if (p.status === 'crashed') return 'bad'
  return 'neutral'
}

function Dot({ p }: { p?: ProcessInfo }) {
  return (
    <span
      className={clsx(
        'size-2.5 shrink-0 rounded-full',
        !p && 'bg-line-strong',
        p?.status === 'running' && 'pulse bg-ok',
        p?.status === 'crashed' && 'bg-bad',
        (p?.status === 'exited' || p?.status === 'stopped') && 'bg-faint'
      )}
    />
  )
}

function LogView({ proc, feature }: { proc: ProcessInfo; feature: Feature }) {
  const live = useStore((s) => s.procOutput[proc.id] ?? '')
  // Snapshot from the main process + whatever streamed in after the snapshot was taken.
  const [snap, setSnap] = useState<{ text: string; liveLen: number }>({ text: '', liveLen: 0 })
  const [input, setInput] = useState('')
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const liveLen = useStore.getState().procOutput[proc.id]?.length ?? 0
    void window.api.processOutput(proc.id).then((text) => setSnap({ text, liveLen }))
  }, [proc.id, proc.startedAt])

  const text = snap.text + live.slice(snap.liveLen)
  useEffect(() => {
    if (ref.current && stick.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])

  const send = async () => {
    if (!input) return
    await act(() => window.api.writeProcessInput(proc.id, input))
    setInput('')
  }

  const fix = () =>
    act(
      () =>
        window.api.sendPrompt(
          feature.id,
          `The background process "${proc.name}" (\`${proc.command}\`) ${proc.status === 'crashed' ? `crashed with exit code ${proc.code}` : 'is showing errors'}. Its full log is at ${proc.logFile}. Here is the end of it:\n\n\`\`\`\n${text.split('\n').slice(-120).join('\n')}\n\`\`\`\n\nFind the cause and fix it.`
        ),
      'Sent to the agent'
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Dot p={proc} />
        <span className="max-w-[45%] shrink-0 truncate text-sm font-medium">{proc.name}</span>
        <code className="truncate font-mono text-xs text-faint">{proc.command}</code>
        <div className="flex-1" />
        {proc.status !== 'running' && <Badge tone={statusTone(proc)}>{proc.status === 'crashed' ? `exit ${proc.code}` : proc.status}</Badge>}
        {(proc.status === 'crashed' || /error|exception|failed/i.test(text.slice(-4000))) && (
          <Button size="sm" variant="ghost" icon={<Wand2 className="size-4" />} onClick={fix}>
            Fix with agent
          </Button>
        )}
        {proc.status === 'running' ? (
          <>
            <IconButton title="Restart" onClick={() => void act(() => window.api.restartProcess(proc.id))}>
              <RotateCw className="size-4" />
            </IconButton>
            <IconButton title="Stop" onClick={() => void act(() => window.api.stopProcess(proc.id))}>
              <Square className="size-4" />
            </IconButton>
          </>
        ) : (
          <IconButton title="Run again" onClick={() => void act(() => window.api.restartProcess(proc.id))}>
            <Play className="size-4" />
          </IconButton>
        )}
      </div>
      <pre
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="selectable min-h-0 flex-1 overflow-auto bg-bg px-3 py-2 font-mono text-xs leading-[1.55] whitespace-pre-wrap text-muted"
      >
        {text || 'No output yet.'}
      </pre>
      {proc.status === 'running' && (
        <form
          className="flex items-center gap-2 border-t border-line px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <span className="font-mono text-xs text-faint">stdin</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type input for this process and press ↵"
            aria-label={`Input for ${proc.name}`}
            className="h-8 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-faint"
          />
        </form>
      )}
    </div>
  )
}

export function TerminalPanel({ feature, project }: { feature: Feature; project: Project }) {
  const all = useStore((s) => s.processes)
  const procs = useMemo(() => Object.values(all).filter((p) => p.featureId === feature.id).sort((a, b) => a.startedAt - b.startedAt), [all, feature.id])
  const services: ServiceDef[] = project.services ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)

  const serviceProc = (name: string) => [...procs].reverse().find((p) => p.kind === 'service' && p.name === name)
  const commands = procs.filter((p) => p.kind === 'command').slice(-12).reverse()
  const current = procs.find((p) => p.id === selected) ?? procs.find((p) => p.status === 'running') ?? procs[procs.length - 1]

  const run = async (command: string) => {
    const c = command.trim()
    if (!c) return
    setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50))
    setHIdx(-1)
    setCmd('')
    const id = await act(() => window.api.runCommand(feature.id, c))
    if (id) setSelected(id)
  }

  const startService = async (name: string) => {
    const id = await act(() => window.api.startService(feature.id, name))
    if (id) setSelected(id)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line">
        <div className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">Services</div>
        {services.length === 0 ? (
          <div className="px-3 pb-3 text-sm text-faint">No services. Add dev servers or workers in project settings.</div>
        ) : (
          <ul className="px-2 pb-2">
            {services.map((svc) => {
              const p = serviceProc(svc.name)
              return (
                <li key={svc.name}>
                  <div
                    className={clsx(
                      'group flex items-center gap-2.5 rounded-lg px-2 py-1.5',
                      current && p && current.id === p.id ? 'bg-active' : 'hover:bg-raised'
                    )}
                  >
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => p && setSelected(p.id)}>
                      <Dot p={p} />
                      <span className="text-sm font-medium">{svc.name}</span>
                      <code className="truncate font-mono text-xs text-faint">{svc.command}</code>
                      {svc.autoStart && <span className="text-2xs text-faint">auto</span>}
                    </button>
                    {p?.status === 'running' ? (
                      <>
                        <IconButton title={`Restart ${svc.name}`} className="size-7" onClick={() => void act(() => window.api.restartProcess(p.id))}>
                          <RotateCw className="size-3.5" />
                        </IconButton>
                        <IconButton title={`Stop ${svc.name}`} className="size-7" onClick={() => void act(() => window.api.stopProcess(p.id))}>
                          <Square className="size-3.5" />
                        </IconButton>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} onClick={() => startService(svc.name)}>
                        Start
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-center gap-1.5 px-3 pt-1 pb-2">
          {project.quickCommands.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => run(q)}
              className="flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-1 font-mono text-xs text-muted hover:border-line-strong hover:text-fg"
            >
              <Play className="size-3" />
              {q}
            </button>
          ))}
        </div>
        {commands.length > 0 && (
          <ul className="px-2 pb-2">
            {commands.map((p) => (
              <li key={p.id} className={clsx('group flex items-center gap-2.5 rounded-lg px-2 py-1', current?.id === p.id ? 'bg-active' : 'hover:bg-raised')}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setSelected(p.id)}>
                  <Dot p={p} />
                  <code className="truncate font-mono text-xs">{p.command}</code>
                  {p.status !== 'running' && <span className={clsx('text-2xs', p.status === 'crashed' ? 'text-bad' : 'text-faint')}>{p.status === 'crashed' ? `exit ${p.code}` : p.status}</span>}
                </button>
                <IconButton title="Remove" className="size-6 opacity-0 group-hover:opacity-100" onClick={() => void act(() => window.api.removeProcess(p.id))}>
                  {p.status === 'running' ? <X className="size-3.5" /> : <Trash2 className="size-3.5" />}
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      {current ? (
        <LogView key={current.id} proc={current} feature={feature} />
      ) : (
        <Empty icon={<Terminal className="size-7" />} title="Nothing running">
          Start a service above or run a command below. Commands run in {feature.worktreePath}.
        </Empty>
      )}

      <form
        className="flex items-center gap-2 border-t border-line px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void run(cmd)
        }}
      >
        <span className="font-mono text-sm text-fg">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault()
              const i = Math.min(hIdx + 1, history.length - 1)
              setHIdx(i)
              setCmd(history[i])
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              const i = hIdx - 1
              setHIdx(Math.max(i, -1))
              setCmd(i >= 0 ? history[i] : '')
            }
          }}
          placeholder={project.isLaravel ? 'php artisan test --filter=…' : 'npm test'}
          aria-label="Run a command"
          className="h-8 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-faint"
        />
        <CornerDownLeft className="size-4 text-faint" />
      </form>
    </div>
  )
}
