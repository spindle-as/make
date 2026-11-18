import { existsSync } from 'node:fs'
import { exec, run } from './exec'
import { parseGithubRemote } from '@shared/util'
import type { GitFileChange, GitStatusInfo } from '@shared/types'

const git = (cwd: string, args: string[], timeoutMs = 60_000) => run('git', args, { cwd, timeoutMs })

export async function isGitRepo(path: string): Promise<boolean> {
  const r = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: path })
  return r.code === 0 && r.stdout.trim() === 'true'
}

export async function repoRoot(path: string): Promise<string> {
  return git(path, ['rev-parse', '--show-toplevel'])
}

export async function githubRepo(path: string): Promise<string | undefined> {
  const r = await exec('git', ['remote', 'get-url', 'origin'], { cwd: path })
  return r.code === 0 ? parseGithubRemote(r.stdout) : undefined
}

export async function defaultBranch(path: string): Promise<string> {
  const r = await exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: path })
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().replace(/^origin\//, '')
  for (const b of ['main', 'master', 'develop']) {
    const x = await exec('git', ['rev-parse', '--verify', '--quiet', b], { cwd: path })
    if (x.code === 0) return b
  }
  return (await exec('git', ['branch', '--show-current'], { cwd: path })).stdout.trim() || 'main'
}

export async function currentBranch(path: string): Promise<string> {
  return (await exec('git', ['branch', '--show-current'], { cwd: path })).stdout.trim()
}

async function hasRemote(cwd: string): Promise<boolean> {
  const r = await exec('git', ['remote'], { cwd })
  return r.stdout.split('\n').includes('origin')
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await exec('git', ['rev-parse', '--verify', '--quiet', ref], { cwd })).code === 0
}

/** Create a worktree on a fresh branch cut from the latest base branch. */
export async function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  if (existsSync(path)) throw new Error(`Worktree path already exists: ${path}`)
  let startPoint = base
  if (await hasRemote(repo)) {
    await exec('git', ['fetch', 'origin', base], { cwd: repo, timeoutMs: 60_000 })
    if (await refExists(repo, `origin/${base}`)) startPoint = `origin/${base}`
  }
  if (await refExists(repo, `refs/heads/${branch}`)) {
    await git(repo, ['worktree', 'add', path, branch])
  } else {
    await git(repo, ['worktree', 'add', '--no-track', '-b', branch, path, startPoint])
  }
}

export async function removeWorktree(repo: string, path: string): Promise<void> {
  if (!existsSync(path)) {
    await exec('git', ['worktree', 'prune'], { cwd: repo })
    return
  }
  await git(repo, ['worktree', 'remove', '--force', path])
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  await exec('git', ['branch', '-D', branch], { cwd: repo })
}

export async function mergeBase(cwd: string, base: string): Promise<string> {
  for (const ref of [`origin/${base}`, base]) {
    const r = await exec('git', ['merge-base', 'HEAD', ref], { cwd })
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim()
  }
  return 'HEAD'
}

export function parseNumstat(out: string): Map<string, { a: number; d: number }> {
  const m = new Map<string, { a: number; d: number }>()
  for (const line of out.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [a, d, ...rest] = parts
    let path = rest.join('\t')
    // rename syntax: "src/{a => b}/x" or "a => b"
    const brace = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
    if (brace) path = `${brace[1]}${brace[3]}${brace[4]}`.replace('//', '/')
    else if (path.includes(' => ')) path = path.split(' => ')[1]
    m.set(path, { a: a === '-' ? 0 : Number(a), d: d === '-' ? 0 : Number(d) })
  }
  return m
}

export function parsePorcelain(out: string): { path: string; status: string }[] {
  const files: { path: string; status: string }[] = []
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ')[1]
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    files.push({ path, status: code.trim() || code })
  }
  return files
}

export async function status(cwd: string, base: string): Promise<GitStatusInfo> {
  const branch = await currentBranch(cwd)
  const mb = await mergeBase(cwd, base)
  const [porcelain, numstat, nameStatus, log, ab] = await Promise.all([
    exec('git', ['status', '--porcelain=v1', '-uall'], { cwd }),
    exec('git', ['diff', '--numstat', '-M', mb], { cwd }),
    exec('git', ['diff', '--name-status', '-M', mb], { cwd }),
    exec('git', ['log', '--format=%h%x09%s', `${mb}..HEAD`], { cwd }),
    exec('git', ['rev-list', '--left-right', '--count', `HEAD...@{upstream}`], { cwd })
  ])
  const nums = parseNumstat(numstat.stdout)
  const files = new Map<string, GitFileChange>()
  for (const line of nameStatus.stdout.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const st = parts[0][0]
    const path = parts[parts.length - 1]
    const n = nums.get(path)
    files.set(path, { path, status: st, additions: n?.a ?? 0, deletions: n?.d ?? 0 })
  }
  const working = parsePorcelain(porcelain.stdout)
  for (const w of working) {
    if (w.status === '??' && !files.has(w.path)) {
      const lines = await exec('wc', ['-l', w.path], { cwd })
      files.set(w.path, {
        path: w.path,
        status: 'A',
        additions: parseInt(lines.stdout.trim(), 10) || 0,
        deletions: 0
      })
    }
  }
  let ahead = 0
  let behind = 0
  if (ab.code === 0) {
    const [a, b] = ab.stdout.trim().split(/\s+/).map(Number)
    ahead = a || 0
    behind = b || 0
  } else {
    ahead = log.stdout.trim() ? log.stdout.trim().split('\n').length : 0
  }
  return {
    branch,
    ahead,
    behind,
    dirty: working.length > 0,
    files: [...files.values()].sort((x, y) => x.path.localeCompare(y.path)),
    commitsAhead: log.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, ...s] = l.split('\t')
        return { sha, subject: s.join('\t') }
      })
  }
}

/** Unified diff of everything on this branch vs. its merge-base (committed + uncommitted + untracked). */
export async function diff(cwd: string, base: string, file?: string): Promise<string> {
  const mb = await mergeBase(cwd, base)
  const args = ['diff', '-M', '--no-color', mb]
  if (file) args.push('--', file)
  const tracked = (await exec('git', args, { cwd, timeoutMs: 30_000 })).stdout
  const untracked = (await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd })).stdout
    .split('\n')
    .filter(Boolean)
    .filter((f) => !file || f === file)
  let extra = ''
  for (const f of untracked.slice(0, 200)) {
    const r = await exec('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd })
    extra += r.stdout
  }
  return tracked + extra
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '-A'])
  const staged = await exec('git', ['diff', '--cached', '--quiet'], { cwd })
  if (staged.code === 0) return 'Nothing to commit'
  return git(cwd, ['commit', '-m', message])
}

export async function push(cwd: string, branch: string, remote = 'origin'): Promise<string> {
  const r = await exec('git', ['push', '-u', remote, branch], { cwd, timeoutMs: 120_000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git push failed')
  return (r.stderr + r.stdout).trim()
}

export async function syncWithBase(cwd: string, base: string): Promise<string> {
  if (await hasRemote(cwd)) await exec('git', ['fetch', 'origin', base], { cwd, timeoutMs: 60_000 })
  const ref = (await refExists(cwd, `origin/${base}`)) ? `origin/${base}` : base
  // --autostash: agents usually leave uncommitted work; stash it around the merge.
  const r = await exec('git', ['merge', '--no-edit', '--autostash', ref], { cwd })
  if (r.code !== 0) {
    const out = `${r.stdout}${r.stderr}`.trim()
    if (/CONFLICT/.test(out)) {
      throw new Error(`Merging ${ref} produced conflicts. Resolve them (or ask the agent to) and commit.\n\n${out}`)
    }
    throw new Error(`Could not merge ${ref}: ${out}`)
  }
  return r.stdout.trim() || 'Up to date'
}

export async function discardFile(cwd: string, file: string, base: string): Promise<void> {
  const tracked = await exec('git', ['ls-files', '--error-unmatch', file], { cwd })
  if (tracked.code !== 0) {
    await exec('rm', ['-f', '--', file], { cwd })
    return
  }
  const mb = await mergeBase(cwd, base)
  const inBase = await exec('git', ['cat-file', '-e', `${mb}:${file}`], { cwd })
  if (inBase.code === 0) await git(cwd, ['checkout', mb, '--', file])
  else await git(cwd, ['rm', '-f', '--', file])
}
