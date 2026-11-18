import { existsSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { RuntimeMatch } from '@shared/types'

/**
 * Finds installed PHP and Node versions (Herd, Homebrew, nvm, fnm) so a project can pin
 * e.g. PHP 8.3 / Node 22 without the user touching their shell. Pinning works by putting
 * the matching bin directory first on PATH for everything Spindle runs for that project.
 */

const HOME = homedir()
const HERD = join(HOME, 'Library', 'Application Support', 'Herd')
const BREW = ['/opt/homebrew/opt', '/usr/local/opt']

const ls = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Compare dotted versions numerically, descending. */
export function byVersionDesc(a: { version: string }, b: { version: string }): number {
  const pa = a.version.split('.').map(Number)
  const pb = b.version.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** "^8.2", ">=8.2", "v22", "22.11" → "8.2" / "22" / "22.11"; empty for "auto"/unparseable. */
export function cleanVersion(v: string | undefined): string {
  const m = (v ?? '').match(/(\d+(?:\.\d+){0,2})/)
  return m ? m[1] : ''
}

/** Highest installed version matching a requested prefix ("8.3" matches 8.3.x, "22" matches 22.x.y). */
export function pick(list: RuntimeMatch[], wanted: string | undefined): RuntimeMatch | null {
  const w = cleanVersion(wanted)
  if (!w) return null
  const matches = list.filter((r) => r.version === w || r.version.startsWith(w + '.'))
  return matches.sort(byVersionDesc)[0] ?? null
}

/** Installed PHP versions. Herd ships binaries named php83; Homebrew has php@8.3/bin/php. */
export function listPhp(shimRoot: string): RuntimeMatch[] {
  const out: RuntimeMatch[] = []
  for (const name of ls(join(HERD, 'bin'))) {
    const m = name.match(/^php(\d)(\d+)$/)
    if (m) out.push({ version: `${m[1]}.${m[2]}`, dir: shim(shimRoot, `php-${m[1]}.${m[2]}-herd`, join(HERD, 'bin', name), 'php'), source: 'Herd' })
  }
  for (const root of BREW) {
    for (const name of ls(root)) {
      const at = name.match(/^php@(\d+\.\d+)$/)
      let version = at?.[1]
      if (name === 'php') {
        // Unversioned formula: read the version from the Cellar path it points to.
        try {
          version = cleanVersion(basename(realpathSync(join(root, name)))).split('.').slice(0, 2).join('.')
        } catch {
          version = undefined
        }
      }
      if (version && existsSync(join(root, name, 'bin', 'php')) && !out.some((r) => r.version === version)) {
        out.push({ version, dir: join(root, name, 'bin'), source: 'Homebrew' })
      }
    }
  }
  return out.sort(byVersionDesc)
}

/** Installed Node versions from Herd's nvm, nvm, fnm and Homebrew node@X. */
export function listNode(): RuntimeMatch[] {
  const out: RuntimeMatch[] = []
  const add = (version: string, dir: string, source: string) => {
    if (existsSync(join(dir, 'node')) && !out.some((r) => r.version === version)) out.push({ version, dir, source })
  }
  for (const [root, source] of [
    [join(HERD, 'config', 'nvm', 'versions', 'node'), 'Herd'],
    [join(HOME, '.nvm', 'versions', 'node'), 'nvm']
  ] as const) {
    for (const v of ls(root)) add(cleanVersion(v), join(root, v, 'bin'), source)
  }
  const fnm = join(HOME, '.local', 'share', 'fnm', 'node-versions')
  for (const v of ls(fnm)) add(cleanVersion(v), join(fnm, v, 'installation', 'bin'), 'fnm')
  for (const root of BREW) {
    for (const name of ls(root)) {
      const m = name.match(/^node@(\d+)$/)
      if (m) {
        let version = m[1]
        try {
          version = cleanVersion(basename(realpathSync(join(root, name)))) || version
        } catch {
          /* keep major */
        }
        add(version, join(root, name, 'bin'), 'Homebrew')
      }
    }
  }
  return out.sort(byVersionDesc)
}

/** A directory containing `name` → target, so a binary like Herd's php83 can be found as `php`. */
function shim(shimRoot: string, dirName: string, target: string, name: string): string {
  const dir = join(shimRoot, dirName)
  const link = join(dir, name)
  try {
    mkdirSync(dir, { recursive: true })
    let current: string | null = null
    try {
      current = readlinkSync(link)
    } catch {
      current = null
    }
    if (current !== target) {
      if (current !== null) unlinkSync(link)
      symlinkSync(target, link)
    }
  } catch {
    /* read-only or racing: the directory may still work */
  }
  return dir
}

export interface ResolvedRuntime {
  php: RuntimeMatch | null
  node: RuntimeMatch | null
  /** directories to put first on PATH */
  path: string[]
  /** human-readable problems, e.g. "PHP 8.2 isn't installed" */
  missing: string[]
}

export function resolveRuntime(runtime: { php?: string; node?: string }, shimRoot: string): ResolvedRuntime {
  const php = runtime.php ? pick(listPhp(shimRoot), runtime.php) : null
  const node = runtime.node ? pick(listNode(), runtime.node) : null
  const missing: string[] = []
  if (runtime.php && !php) missing.push(`PHP ${cleanVersion(runtime.php)} isn’t installed — add it in Herd (PHP tab) or run: brew install php@${cleanVersion(runtime.php)}`)
  if (runtime.node && !node) missing.push(`Node ${cleanVersion(runtime.node)} isn’t installed — add it in Herd (Node tab) or with nvm: nvm install ${cleanVersion(runtime.node)}`)
  return { php, node, path: [php?.dir, node?.dir].filter((d): d is string => !!d), missing }
}
