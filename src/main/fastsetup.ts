import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exec } from './exec'

/**
 * Fast workspace setup.
 *
 * Installing dependencies and building assets from scratch in every new worktree is what made
 * setup slow. On APFS a whole folder can be cloned copy-on-write in one system call (~0.1s for
 * tens of thousands of files, no extra disk space), so when a worktree's lockfile matches a
 * `vendor/` or `node_modules/` that already exists — in the main checkout, or a cached copy from an
 * earlier change — Spindle clones it instead of installing. Built assets are cached the same way,
 * keyed by a hash of everything the build reads.
 */

/** A tiny helper that calls clonefile(2) on a whole directory tree. */
export const CLONEDIR_SOURCE = `#include <sys/clonefile.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: clonedir <src> <dst>\\n"); return 2; }
  if (clonefile(argv[1], argv[2], CLONE_NOFOLLOW) != 0) { fprintf(stderr, "clonefile: %s\\n", strerror(errno)); return 1; }
  return 0;
}
`

let helper: string | null | undefined

/**
 * Find (or build once) the clonedir helper: bundled in the app's resources, or compiled into the
 * user data folder when Xcode's command line tools are there. Without it, cloning falls back to
 * `cp -c` (still copy-on-write, but file by file).
 */
export async function ensureCloneHelper(candidates: string[], buildInto: string): Promise<string | null> {
  if (helper !== undefined) return helper
  for (const c of candidates) {
    if (existsSync(c)) return (helper = c)
  }
  if (process.platform !== 'darwin') return (helper = null)
  try {
    mkdirSync(buildInto, { recursive: true })
    const src = join(buildInto, 'clonedir.c')
    const out = join(buildInto, 'clonedir')
    if (existsSync(out)) return (helper = out)
    writeFileSync(src, CLONEDIR_SOURCE)
    const r = await exec('cc', ['-O2', '-o', out, src], { timeoutMs: 30_000 })
    return (helper = r.code === 0 && existsSync(out) ? out : null)
  } catch {
    return (helper = null)
  }
}

/** Clone a directory copy-on-write. `dst` must not exist. Returns how, or false when it couldn't. */
export async function cloneDir(src: string, dst: string): Promise<'clonefile' | 'cp' | false> {
  if (!existsSync(src) || existsSync(dst)) return false
  mkdirSync(dirname(dst), { recursive: true })
  if (helper) {
    const r = await exec(helper, [src, dst], { timeoutMs: 60_000 })
    if (r.code === 0) return 'clonefile'
    rmSync(dst, { recursive: true, force: true })
  }
  // -c: clonefile per file (APFS); falls back to a normal copy on other file systems.
  const r = await exec('cp', ['-cR', src, dst], { timeoutMs: 10 * 60_000 })
  if (r.code === 0) return 'cp'
  rmSync(dst, { recursive: true, force: true })
  return false
}

export interface InstallKind {
  /** folder the install produces */
  dir: 'vendor' | 'node_modules'
  /** lockfile that pins it */
  lock: string
  manager: 'composer' | 'npm' | 'pnpm' | 'yarn' | 'bun'
}

/** Which dependency folder a setup command installs, if it's an install command. */
export function installKind(cmd: string): InstallKind | null {
  const c = cmd.trim()
  if (/^composer install\b/.test(c)) return { dir: 'vendor', lock: 'composer.lock', manager: 'composer' }
  if (/^npm (ci|install|i)\b/.test(c)) return { dir: 'node_modules', lock: 'package-lock.json', manager: 'npm' }
  if (/^pnpm (install|i)\b/.test(c)) return { dir: 'node_modules', lock: 'pnpm-lock.yaml', manager: 'pnpm' }
  if (/^yarn( install)?\s*($|--)/.test(c)) return { dir: 'node_modules', lock: 'yarn.lock', manager: 'yarn' }
  if (/^bun (install|i)\b/.test(c)) return { dir: 'node_modules', lock: 'bun.lock', manager: 'bun' }
  return null
}

export const isBuildCommand = (cmd: string): boolean => /^(npm run|pnpm( run)?|yarn( run)?|bun run) build\b/.test(cmd.trim())

/**
 * Split the setup commands into what can run together. Commands before the first install keep
 * running first, one by one (they may prepare things the installs need); installs run in
 * parallel; builds wait only for the JavaScript packages; everything else keeps its order after
 * the installs.
 */
export function planSetup(cmds: string[]): { before: string[]; installs: string[]; builds: string[]; after: string[] } {
  const first = cmds.findIndex((c) => installKind(c))
  const before = first === -1 ? [] : cmds.slice(0, first)
  const rest = first === -1 ? cmds : cmds.slice(first)
  return {
    before,
    installs: rest.filter((c) => installKind(c)),
    builds: rest.filter((c) => isBuildCommand(c)),
    after: rest.filter((c) => !installKind(c) && !isBuildCommand(c))
  }
}

const sha = (s: string | Buffer) => createHash('sha1').update(s).digest('hex').slice(0, 16)
const readJson = (f: string): any => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

/** Hash of a lockfile (the cache key for its dependency folder). */
export function lockHash(root: string, lock: string): string | null {
  try {
    return sha(readFileSync(join(root, lock)))
  } catch {
    return null
  }
}

/**
 * Is this installed folder exactly what the lockfile asks for? Checked from the package managers'
 * own records (Composer's installed.json, npm's hidden lockfile), so a stale folder is never
 * reused. Other managers: only an identical lockfile next to the folder counts.
 */
export function depsMatchLock(kind: InstallKind, depRoot: string, lockRoot: string): boolean {
  const depDir = join(depRoot, kind.dir)
  if (!existsSync(depDir)) return false
  if (kind.manager === 'composer') {
    const lock = readJson(join(lockRoot, 'composer.lock'))
    const installed = readJson(join(depDir, 'composer', 'installed.json'))
    if (!lock || !installed) return false
    const want = new Set([...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])].map((p: any) => `${p.name}@${p.version}`))
    const have = new Set(((installed.packages ?? installed) as any[]).map((p: any) => `${p.name}@${p.version}`))
    return want.size === have.size && [...want].every((x) => have.has(x))
  }
  if (kind.manager === 'npm') {
    const lock = readJson(join(lockRoot, 'package-lock.json'))
    const hidden = readJson(join(depDir, '.package-lock.json'))
    if (!lock?.packages || !hidden?.packages) return false
    const want = Object.entries(lock.packages as Record<string, any>).filter(([k]) => k.startsWith('node_modules/'))
    const have = hidden.packages as Record<string, any>
    // Everything installed matches the lock, and everything required (not optional) is installed.
    for (const [k, v] of Object.entries(have)) if (lock.packages[k]?.version !== v?.version) return false
    return want.every(([k, v]) => v.optional || v.peer || have[k])
  }
  return lockHash(depRoot, kind.lock) !== null && lockHash(depRoot, kind.lock) === lockHash(lockRoot, kind.lock)
}

/**
 * Cache key for a dependency folder: the lockfile's hash — or, for an npm project without a
 * lockfile, package.json's (an install would resolve the same ranges).
 */
export function depKey(kind: InstallKind, root: string): string | null {
  const h = lockHash(root, kind.lock)
  if (h) return h
  if (kind.manager === 'npm' && existsSync(join(root, 'package.json'))) return `pkg-${lockHash(root, 'package.json')}`
  return null
}

/** Can `depRoot`'s installed folder stand in for an install in `root`? */
export function canReuse(kind: InstallKind, depRoot: string, root: string): boolean {
  if (existsSync(join(root, kind.lock))) return depsMatchLock(kind, depRoot, root)
  return kind.manager === 'npm' && existsSync(join(depRoot, 'node_modules')) && lockHash(depRoot, 'package.json') === lockHash(root, 'package.json')
}

/** What a Laravel/Vite build reads. Changes to any of these mean the cached build is stale. */
const BUILD_INPUTS = ['resources', 'app', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js', 'postcss.config.cjs', 'tsconfig.json', 'components.json', 'routes']

/**
 * Cache key for a worktree's built assets: the git objects of every build input at HEAD plus the
 * VITE_* settings from .env. Null when those inputs have uncommitted edits (the key wouldn't
 * describe them).
 */
export async function buildKey(root: string): Promise<string | null> {
  const inputs = BUILD_INPUTS.filter((p) => existsSync(join(root, p)))
  if (!inputs.length) return null
  const dirty = await exec('git', ['status', '--porcelain', '--', ...inputs], { cwd: root, timeoutMs: 20_000 })
  if (dirty.code !== 0 || dirty.stdout.trim()) return null
  const tree = await exec('git', ['ls-tree', 'HEAD', '--', ...inputs], { cwd: root, timeoutMs: 20_000 })
  if (tree.code !== 0) return null
  let vite = ''
  try {
    vite = readFileSync(join(root, '.env'), 'utf8')
      .split('\n')
      .filter((l) => /^VITE_/.test(l))
      .sort()
      .join('\n')
  } catch {
    /* no .env */
  }
  return sha(tree.stdout + vite)
}

/**
 * Copy-on-write cache of dependency folders and builds, per project: `<root>/<project>/<kind>-<hash>`.
 * Storing costs no disk space until files change; the oldest entries are pruned.
 */
export class SetupCache {
  constructor(private root: string, private keep = 3) {}

  path(projectId: string, kind: string, key: string): string {
    return join(this.root, projectId, `${kind}-${key}`)
  }

  /** The cached folder, ready to clone from — or null. */
  get(projectId: string, kind: string, key: string): string | null {
    const p = this.path(projectId, kind, key)
    return existsSync(join(p, '.spindle-complete')) ? join(p, 'data') : null
  }

  /** Clone `src` into the cache (in the background is fine). */
  async put(projectId: string, kind: string, key: string, src: string): Promise<void> {
    if (!existsSync(src) || this.get(projectId, kind, key)) return
    const p = this.path(projectId, kind, key)
    rmSync(p, { recursive: true, force: true })
    mkdirSync(p, { recursive: true })
    const how = await cloneDir(src, join(p, 'data'))
    if (!how) return void rmSync(p, { recursive: true, force: true })
    writeFileSync(join(p, '.spindle-complete'), new Date().toISOString())
    this.prune(projectId, kind)
  }

  private prune(projectId: string, kind: string): void {
    const dir = join(this.root, projectId)
    let entries: { name: string; at: number }[] = []
    try {
      entries = readdirSync(dir)
        .filter((n) => n.startsWith(`${kind}-`))
        .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    } catch {
      return
    }
    entries
      .sort((a, b) => b.at - a.at)
      .slice(this.keep)
      .forEach((e) => rmSync(join(dir, e.name), { recursive: true, force: true }))
  }
}
