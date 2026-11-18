import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessInfo, ServiceDef } from '@shared/types'
import { uid } from '@shared/util'
import { shellQuote } from './exec'

interface Proc {
  info: ProcessInfo
  child?: ChildProcess
  output: string
  cwd: string
  env: Record<string, string>
  stopping: boolean
}

export interface ProcessHooks {
  onChanged(p: ProcessInfo): void
  onRemoved(id: string, featureId: string): void
  onOutput(id: string, featureId: string, stream: 'stdout' | 'stderr', data: string): void
}

const MAX_BUFFER = 400_000
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g

/**
 * Long-running processes per feature (dev servers, queue workers) and one-off commands.
 * Each runs in its own process group so `npm run dev` and its children stop together,
 * and its output is mirrored to a log file the agent can read.
 */
export class ProcessManager {
  private procs = new Map<string, Proc>()

  constructor(
    private logDir: string,
    private hooks: ProcessHooks
  ) {
    mkdirSync(logDir, { recursive: true })
  }

  list(featureId?: string): ProcessInfo[] {
    return [...this.procs.values()].map((p) => p.info).filter((i) => !featureId || i.featureId === featureId)
  }

  output(id: string): string {
    const p = this.procs.get(id)
    if (!p) return ''
    if (p.output) return p.output
    return existsSync(p.info.logFile) ? readFileSync(p.info.logFile, 'utf8').slice(-MAX_BUFFER) : ''
  }

  /** Text block for the agent's system prompt: what is running and where the logs are. */
  describeFor(featureId: string): string {
    const running = this.list(featureId).filter((p) => p.status === 'running' && p.kind === 'service')
    if (!running.length) return ''
    return [
      'Background processes are already running for this workspace (managed by Software Factory — do not start them again):',
      ...running.map((p) => `- ${p.name}: \`${p.command}\` — output is written to ${p.logFile}; read it (e.g. tail -n 100) to debug build or runtime errors.`)
    ].join('\n')
  }

  start(featureId: string, name: string, command: string, kind: ProcessInfo['kind'], cwd: string, env: Record<string, string> = {}): ProcessInfo {
    // Re-use the slot of an existing service with the same name.
    const existing = [...this.procs.values()].find((p) => p.info.featureId === featureId && p.info.kind === 'service' && p.info.name === name)
    if (existing && kind === 'service') {
      if (existing.info.status === 'running') return existing.info
      this.procs.delete(existing.info.id)
    }
    const id = uid('pr_')
    const safe = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const logFile = join(this.logDir, featureId, `${safe}-${id.slice(-6)}.log`)
    mkdirSync(join(this.logDir, featureId), { recursive: true })
    writeFileSync(logFile, `$ ${command}\n`)
    const info: ProcessInfo = { id, featureId, name, command, kind, status: 'running', startedAt: Date.now(), logFile }
    const proc: Proc = { info, output: '', cwd, env, stopping: false }
    this.procs.set(id, proc)
    this.spawn(proc)
    return info
  }

  private spawn(proc: Proc): void {
    const { info } = proc
    // Dev tools refuse to run when CI is set at all (even empty), so drop it.
    const { CI: _ci, ...baseEnv } = process.env
    // Pinned runtimes (.spindle runtime) go first on PATH — after the login shell's own profile ran.
    const pathPrefix = proc.env.SPINDLE_PATH ? `export PATH=${shellQuote(proc.env.SPINDLE_PATH)}:"$PATH"; ` : ''
    const child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', pathPrefix + info.command], {
      cwd: proc.cwd,
      env: { ...baseEnv, ...proc.env, FORCE_COLOR: '0', LARAVEL_BYPASS_ENV_CHECK: '1' },
      detached: true, // own process group → we can signal the whole tree
      stdio: ['pipe', 'pipe', 'pipe']
    })
    proc.child = child
    proc.stopping = false
    info.status = 'running'
    info.startedAt = Date.now()
    info.endedAt = undefined
    info.code = undefined
    this.hooks.onChanged({ ...info })

    const onData = (stream: 'stdout' | 'stderr') => (d: Buffer) => {
      const text = d.toString().replace(ANSI, '')
      proc.output = (proc.output + text).slice(-MAX_BUFFER)
      try {
        appendFileSync(info.logFile, text)
      } catch {
        /* log dir removed */
      }
      this.hooks.onOutput(info.id, info.featureId, stream, text)
    }
    child.stdout!.on('data', onData('stdout'))
    child.stderr!.on('data', onData('stderr'))
    child.stdin!.on('error', () => {})
    child.on('error', (e) => onData('stderr')(Buffer.from(`\n${e.message}\n`)))
    child.on('close', (code) => {
      if (proc.child !== child) return
      proc.child = undefined
      info.code = code
      info.endedAt = Date.now()
      info.status = proc.stopping ? 'stopped' : code === 0 ? 'exited' : 'crashed'
      this.hooks.onChanged({ ...info })
    })
  }

  /** Resolves when the process exits (immediately if it already has). */
  wait(id: string): Promise<ProcessInfo> {
    const p = this.procs.get(id)
    if (!p) return Promise.reject(new Error('Unknown process'))
    if (!p.child) return Promise.resolve({ ...p.info })
    return new Promise((resolve) => p.child!.once('close', () => setTimeout(() => resolve({ ...p.info }), 0)))
  }

  write(id: string, text: string): void {
    const p = this.procs.get(id)
    if (!p?.child?.stdin?.writable) throw new Error('That process is not running.')
    p.child.stdin.write(text.endsWith('\n') ? text : text + '\n')
  }

  stop(id: string): Promise<void> {
    const p = this.procs.get(id)
    if (!p?.child) return Promise.resolve()
    p.stopping = true
    const child = p.child
    const pid = child.pid
    return new Promise((resolve) => {
      const done = () => resolve()
      child.once('close', done)
      try {
        if (pid) process.kill(-pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
      setTimeout(() => {
        if (p.child === child) {
          try {
            if (pid) process.kill(-pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        }
        resolve()
      }, 4000)
    })
  }

  async restart(id: string): Promise<ProcessInfo> {
    const p = this.procs.get(id)
    if (!p) throw new Error('Unknown process')
    await this.stop(id)
    proc_reset(p)
    this.spawn(p)
    return p.info
  }

  async remove(id: string): Promise<void> {
    const p = this.procs.get(id)
    if (!p) return
    await this.stop(id)
    this.procs.delete(id)
    this.hooks.onRemoved(id, p.info.featureId)
  }

  async stopFeature(featureId: string): Promise<void> {
    await Promise.all(this.list(featureId).map((i) => this.stop(i.id)))
  }

  async removeFeature(featureId: string): Promise<void> {
    await Promise.all(this.list(featureId).map((i) => this.remove(i.id)))
  }

  /** Synchronous best-effort kill for app shutdown. */
  killAll(): void {
    for (const p of this.procs.values()) {
      const pid = p.child?.pid
      if (!pid) continue
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }
}

function proc_reset(p: Proc): void {
  p.output = ''
  try {
    writeFileSync(p.info.logFile, `$ ${p.info.command}\n`)
  } catch {
    /* ignore */
  }
}

/** Sensible default services for a project, detected from its files. */
export function detectServices(root: string, env: Record<string, string>): ServiceDef[] {
  const out: ServiceDef[] = []
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    if (pkg.scripts?.dev) out.push({ name: 'Dev server', command: 'npm run dev', autoStart: true })
  } catch {
    /* no package.json */
  }
  if (existsSync(join(root, 'artisan'))) {
    const queue = (env.QUEUE_CONNECTION || 'sync').toLowerCase()
    if (existsSync(join(root, 'config', 'horizon.php'))) out.push({ name: 'Horizon', command: 'php artisan horizon', autoStart: queue !== 'sync' })
    else if (queue !== 'sync') out.push({ name: 'Queue worker', command: 'php artisan queue:work --tries=1', autoStart: true })
    if (existsSync(join(root, 'config', 'reverb.php'))) out.push({ name: 'Reverb', command: 'php artisan reverb:start', autoStart: false })
    out.push({ name: 'Scheduler', command: 'php artisan schedule:work', autoStart: false })
  }
  return out
}
