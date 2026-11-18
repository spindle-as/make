import { spawn, type ChildProcess } from 'node:child_process'

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  input?: string
  timeoutMs?: number
}

/** Run a binary with args (no shell). Never throws; inspect `code`. */
export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child: ChildProcess
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e) })
      return
    }
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(e) })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    else child.stdin?.end()
  })
}

/** Run and throw a readable error on non-zero exit. Returns trimmed stdout. */
export async function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  const r = await exec(cmd, args, opts)
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim() || `${cmd} exited with code ${r.code}`
    throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${msg}`)
  }
  return r.stdout.trim()
}

/** Run a shell snippet through the user's login shell semantics. */
export function shell(script: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return exec(process.env.SHELL || '/bin/zsh', ['-c', script], opts)
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
