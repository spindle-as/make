import { existsSync, readdirSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'
import { exec, shellQuote } from './exec'

/** Most recent laravel*.log in storage/logs (supports daily driver). */
export function localLogFile(root: string): string | undefined {
  const d = join(root, 'storage', 'logs')
  if (!existsSync(d)) return undefined
  const files = readdirSync(d)
    .filter((f) => f.endsWith('.log'))
    .map((f) => ({ f, t: statSync(join(d, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  return files[0] ? join(d, files[0].f) : undefined
}

export async function tailLocal(root: string, lines: number): Promise<string> {
  const file = localLogFile(root)
  if (!file) return `No log file found in ${join(root, 'storage', 'logs')}`
  const r = await exec('tail', ['-n', String(lines), file])
  return `# ${file}\n${r.stdout}`
}

export function clearLocal(root: string): void {
  const file = localLogFile(root)
  if (file) truncateSync(file, 0)
}

/** Read the remote Laravel log over ssh (key-based auth, BatchMode so we never hang on a prompt). */
export async function tailRemote(sshTarget: string, remotePath: string, lines: number): Promise<string> {
  const dir = `${remotePath.replace(/\/$/, '')}/storage/logs`
  const script = `f=$(ls -t ${shellQuote(dir)}/*.log 2>/dev/null | head -n1); if [ -z "$f" ]; then echo "No log files in ${dir}"; else echo "# $f"; tail -n ${Number(lines)} "$f"; fi`
  const r = await exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, script], {
    timeoutMs: 30_000
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `ssh exited with ${r.code}`)
  return r.stdout
}
