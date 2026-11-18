import clsx from 'clsx'
import { Activity, Brain, CheckCircle2, Circle, Cpu, Database, ExternalLink, GitPullRequest, LockKeyhole, Rocket, Server, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IntegrationAction, IntegrationId, IntegrationStatus } from '@shared/types'
import { act, useStore } from '../store'
import { Badge, Button, Input, Spinner } from './ui'

const ICONS: Record<IntegrationId, ReactNode> = {
  claude: <Brain className="size-5" />,
  codex: <Cpu className="size-5" />,
  github: <GitPullRequest className="size-5" />,
  webserver: <LockKeyhole className="size-5" />,
  herd: <Server className="size-5" />,
  dbngin: <Database className="size-5" />,
  ploi: <Rocket className="size-5" />,
  nightwatch: <Activity className="size-5" />
}

const ACTION_LABEL: Record<IntegrationAction, string> = {
  install: 'Install',
  repair: 'Repair',
  login: 'Sign in',
  connect: 'Connect',
  setup: 'Set up'
}

function PloiConnect({ status, onDone }: { status: IntegrationStatus; onDone: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(!status.ready)
  if (!editing)
    return (
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Change token
      </Button>
    )
  const connect = async () => {
    setBusy(true)
    const r = await act(() => window.api.connectPloi(token))
    setBusy(false)
    if (r) {
      useStore.getState().toast('success', `Ploi connected — ${r.servers} server${r.servers === 1 ? '' : 's'}, ${r.sites} site${r.sites === 1 ? '' : 's'}`)
      setToken('')
      setEditing(false)
      onDone()
    }
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && token.trim() && void connect()}
          placeholder="Paste your Ploi API token"
          aria-label="Ploi API token"
        />
        <Button variant="primary" loading={busy} disabled={!token.trim()} onClick={connect}>
          Connect
        </Button>
      </div>
      <button type="button" onClick={() => void window.api.openExternal('https://ploi.io/profile/api-keys')} className="flex items-center gap-1 self-start text-xs text-accent-strong hover:underline">
        Create a token at ploi.io (give it the servers & sites scopes) <ExternalLink className="size-3" />
      </button>
    </div>
  )
}

export function IntegrationsList({ compact }: { compact?: boolean }) {
  const list = useStore((s) => s.integrations)
  const refresh = useStore((s) => s.refreshIntegrations)
  const [busy, setBusy] = useState<string>('')
  const [watching, setWatching] = useState<IntegrationId | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // After an install/sign-in opens in Terminal, poll until that integration is ready (max ~3 min).
  useEffect(() => {
    if (!watching) return
    let n = 0
    timer.current = setInterval(async () => {
      n++
      const next = await refresh()
      if (next.find((i) => i.id === watching)?.ready || n > 60) {
        if (next.find((i) => i.id === watching)?.ready) useStore.getState().toast('success', `${next.find((i) => i.id === watching)?.name} is ready`)
        setWatching(null)
      }
    }, 3000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [watching, refresh])

  const run = async (i: IntegrationStatus, a: IntegrationAction) => {
    setBusy(`${i.id}:${a}`)
    const msg = await act(() => window.api.integrationAction(i.id, a))
    setBusy('')
    if (msg) {
      useStore.getState().toast('info', msg)
      if (a !== 'setup' || i.id === 'webserver') setWatching(i.id)
      else void refresh()
    }
  }

  if (!list) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted">
        <Spinner /> Checking your tools…
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {list.map((i) => (
        <li key={i.id} className={clsx('flex flex-col gap-3 rounded-xl border bg-raised/40 p-4', i.ready ? 'border-line' : i.optional ? 'border-line' : 'border-warn/40')}>
          <div className="flex items-start gap-3">
            <span className={clsx('mt-0.5', i.ready ? 'text-ok' : 'text-muted')}>{ICONS[i.id]}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium">{i.name}</span>
                {!i.optional && !i.ready && <Badge tone="warn">required</Badge>}
                {i.optional && !compact && <span className="text-xs text-faint">optional</span>}
              </div>
              <div className="text-sm text-muted">{i.description}</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                {i.ready ? <CheckCircle2 className="size-4 text-ok" /> : i.installed ? <Circle className="size-4 text-warn" /> : <XCircle className="size-4 text-faint" />}
                <span className={i.ready ? 'text-fg/90' : 'text-muted'}>
                  {i.ready ? [i.account, i.version && `v${i.version.replace(/^v/, '')}`].filter(Boolean).join(' · ') || 'Ready' : i.detail}
                </span>
                {watching === i.id && (
                  <span className="ml-2 flex items-center gap-1.5 text-xs text-faint">
                    <Spinner className="size-3.5" /> waiting for you to finish…
                  </span>
                )}
              </div>
            </div>
            {i.id !== 'ploi' && i.actions.length > 0 && (
              <div className="flex shrink-0 gap-2">
                {i.actions.map((a) => (
                  <Button key={a} size="sm" variant={i.ready ? 'secondary' : 'primary'} loading={busy === `${i.id}:${a}`} onClick={() => run(i, a)}>
                    {i.id === 'webserver' && a === 'setup' ? 'Trust certificates' : i.id === 'dbngin' && a === 'setup' ? 'Open DBngin' : i.id === 'nightwatch' && a === 'setup' ? (i.ready ? 'Add to more agents' : 'Add to agents') : ACTION_LABEL[a]}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {i.id === 'ploi' && <PloiConnect status={i} onDone={() => void refresh()} />}
        </li>
      ))}
    </ul>
  )
}
