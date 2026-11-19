import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnvironment, Project, ServiceDef } from '@shared/types'
import { detectServices } from './processes'
import { detectSetup, installCommand as detectInstall } from './detect'

/**
 * A project's development environment, stored in the repo:
 *
 *   .spindle/config.json      runtime, site, setup steps, processes, database, mail, env
 *   .spindle/instructions.md  how the project works — given to the AI on every turn
 *
 * Being in git, it is shared with the team and each change's worktree has its own copy,
 * so a branch can change how it runs. Commands from the file only run once the user has
 * approved them on this machine (see `commandsHash`).
 */

export const DIR = '.spindle'
export const CONFIG = 'config.json'
export const INSTRUCTIONS = 'instructions.md'

export const configPath = (root: string) => join(root, DIR, CONFIG)
export const instructionsPath = (root: string) => join(root, DIR, INSTRUCTIONS)

const README = `# .spindle

This folder describes how this project runs in development. Spindle reads it
for every change, so commit it and your whole team gets the same setup.

- \`config.json\` — runtime versions (PHP, Node), how the site is served, setup
  steps for a new workspace, background processes (dev server, queue worker…),
  quick commands, per-change database, email capture and extra .env values.
- \`instructions.md\` — how the project works, in plain words. It is given to the
  AI agent on every turn (test accounts, conventions, where things live…).

Edit them in Spindle (Project settings → Environment) or by hand. Commands that
change are shown for approval before Spindle runs them.
`

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Sensible defaults from what is in the project (composer.json, package.json, lockfiles, .nvmrc). */
export function detect(root: string, env: Record<string, string>, hasDatabase: boolean): DevEnvironment {
  const laravel = existsSync(join(root, 'artisan'))
  const pkg = readJson<{ scripts?: Record<string, string>; packageManager?: string }>(join(root, 'package.json'))
  const plan = detectSetup(root)
  const commands = laravel
    ? ['php artisan test', 'php artisan migrate', 'composer install', ...(pkg?.scripts?.build ? [`${runner(root)} run build`] : []), 'php artisan optimize:clear']
    : pkg
      ? [...(pkg.scripts?.test ? [`${runner(root)} test`] : []), ...(pkg.scripts?.build ? [`${runner(root)} run build`] : []), installCommand(root)]
      : []
  const hints = runtimeHints(root)
  return {
    version: 1,
    runtime: { ...(hints.node ? { node: hints.node } : {}) },
    site: {},
    setup: plan.setup,
    prepare: plan.prepare,
    processes: detectServices(root, env),
    commands,
    database: hasDatabase ? { mode: 'clone', migrate: plan.migrate, seed: plan.seed } : { mode: 'shared', migrate: false, seed: false },
    mail: { capture: true },
    env: {}
  }
}

function runner(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

const installCommand = detectInstall

/** Version hints: composer.json's PHP constraint and .nvmrc / .node-version / engines.node. */
export function runtimeHints(root: string): { php?: string; phpMin?: string; node?: string } {
  const composer = readJson<{ require?: Record<string, string> }>(join(root, 'composer.json'))
  const pkg = readJson<{ engines?: Record<string, string> }>(join(root, 'package.json'))
  let node: string | undefined
  for (const f of ['.nvmrc', '.node-version']) {
    try {
      const v = readFileSync(join(root, f), 'utf8').trim().replace(/^v/, '')
      if (/^\d/.test(v)) {
        node = v
        break
      }
    } catch {
      /* none */
    }
  }
  const m = (s?: string) => s?.match(/(\d+(?:\.\d+)?)/)?.[1]
  return { php: m(composer?.require?.php), phpMin: phpMinimum(root), node: node ?? m(pkg?.engines?.node) }
}

/** The PHP version the installed packages really need (Composer's platform check), e.g. "8.4.1". */
export function phpMinimum(root: string): string | undefined {
  try {
    const id = readFileSync(join(root, 'vendor', 'composer', 'platform_check.php'), 'utf8').match(/PHP_VERSION_ID >= (\d{5,})/)?.[1]
    if (!id) return undefined
    const n = Number(id)
    return `${Math.floor(n / 10000)}.${Math.floor(n / 100) % 100}.${n % 100}`
  } catch {
    return undefined
  }
}

/** Is `version` (e.g. "8.3" or "8.3.19") below `min` (e.g. "8.4.1")? A bare minor counts as its newest patch. */
export function belowMinimum(version: string, min: string): boolean {
  const v = version.split('.').map(Number)
  const m = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const a = v[i] ?? Infinity
    if (a !== m[i]) return a < (m[i] ?? 0)
  }
  return false
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined)

/** Validate a parsed file; anything missing or malformed falls back to the detected value. */
export function normalize(raw: unknown, fallback: DevEnvironment): DevEnvironment {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const runtime = r.runtime && typeof r.runtime === 'object' ? r.runtime : {}
  const site = r.site && typeof r.site === 'object' ? r.site : {}
  const processes: ServiceDef[] | undefined = Array.isArray(r.processes)
    ? r.processes
        .filter((x: any) => x && typeof x.command === 'string')
        .map((x: any) => ({ name: str(x.name) ?? x.command.split(' ').slice(0, 3).join(' '), command: x.command, autoStart: x.autoStart !== false }))
    : undefined
  const db = r.database && typeof r.database === 'object' ? r.database : undefined
  const env: Record<string, string> = {}
  if (r.env && typeof r.env === 'object') for (const [k, v] of Object.entries(r.env)) if (/^[A-Z_][A-Z0-9_]*$/i.test(k) && v != null) env[k] = String(v)
  return {
    version: 1,
    runtime: { php: str(runtime.php), node: str(runtime.node) },
    site: { docroot: str(site.docroot), command: str(site.command) },
    setup: strList(r.setup) ?? fallback.setup,
    prepare: strList(r.prepare) ?? fallback.prepare ?? [],
    processes: processes ?? fallback.processes,
    commands: strList(r.commands) ?? fallback.commands,
    database: db
      ? {
          mode: ['shared', 'empty', 'clone'].includes(db.mode) ? db.mode : fallback.database.mode,
          migrate: typeof db.migrate === 'boolean' ? db.migrate : fallback.database.migrate,
          seed: typeof db.seed === 'boolean' ? db.seed : fallback.database.seed
        }
      : fallback.database,
    mail: { capture: r.mail && typeof r.mail.capture === 'boolean' ? r.mail.capture : fallback.mail.capture },
    env: r.env && typeof r.env === 'object' ? env : fallback.env
  }
}

export interface LoadedEnv {
  config: DevEnvironment
  source: 'file' | 'detected'
  root: string
  parseError?: string
}

/** Read `.spindle/config.json` from `root`, falling back to `fallback` when absent or broken. */
export function load(root: string, fallback: DevEnvironment): LoadedEnv {
  const file = configPath(root)
  if (!existsSync(file)) return { config: fallback, source: 'detected', root }
  try {
    return { config: normalize(JSON.parse(readFileSync(file, 'utf8')), fallback), source: 'file', root }
  } catch (e) {
    return { config: fallback, source: 'file', root, parseError: `.spindle/config.json: ${(e as Error).message}` }
  }
}

/** What older projects had in Spindle's own state, as an environment. */
export function fromLegacy(p: Project, detected: DevEnvironment, defaultScript: boolean): DevEnvironment {
  const script = p.setupScript?.trim()
  return {
    ...detected,
    setup: defaultScript || !script ? detected.setup : [p.setupScript.replace(/^#.*\n/gm, '').trim()],
    processes: p.services ?? detected.processes,
    commands: p.quickCommands?.length ? p.quickCommands : detected.commands,
    database: p.database ?? detected.database,
    mail: { capture: p.captureMail !== false }
  }
}

/** Write the config (keeping unknown keys someone added by hand) and, optionally, the instructions. */
export function write(root: string, config: DevEnvironment, instructions?: string): void {
  mkdirSync(join(root, DIR), { recursive: true })
  const existing = readJson<Record<string, unknown>>(configPath(root)) ?? {}
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))
  const out = {
    ...existing,
    version: 1,
    runtime: clean(config.runtime),
    site: clean(config.site),
    setup: config.setup.map((s) => s.trim()).filter(Boolean),
    prepare: (config.prepare ?? []).map((s) => s.trim()).filter(Boolean),
    processes: config.processes.filter((x) => x.command.trim()).map((x) => ({ name: x.name.trim() || x.command, command: x.command.trim(), autoStart: x.autoStart })),
    commands: config.commands.map((s) => s.trim()).filter(Boolean),
    database: config.database,
    mail: config.mail,
    env: config.env
  }
  writeFileSync(configPath(root), JSON.stringify(out, null, 2) + '\n')
  if (instructions !== undefined) {
    if (instructions.trim()) writeFileSync(instructionsPath(root), instructions.trimEnd() + '\n')
    else if (existsSync(instructionsPath(root))) writeFileSync(instructionsPath(root), '')
  }
  if (!existsSync(join(root, DIR, 'README.md'))) writeFileSync(join(root, DIR, 'README.md'), README)
}

/** Content fingerprint of a config file ('none' when absent) — tells whether a branch edited its copy. */
export function fileHash(root: string): string {
  try {
    return createHash('sha256').update(readFileSync(configPath(root))).digest('hex').slice(0, 32)
  } catch {
    return 'none'
  }
}

export function readInstructions(root: string): string {
  try {
    return readFileSync(instructionsPath(root), 'utf8')
  } catch {
    return ''
  }
}

/** Everything in the config that makes Spindle run something on its own. */
export function autoRunCommands(c: DevEnvironment): string[] {
  return [
    ...c.setup.map((s) => `setup: ${s}`),
    ...(c.prepare ?? []).map((s) => `after database: ${s}`),
    ...c.processes.map((p) => `${p.autoStart ? 'auto-start' : 'process'} “${p.name}”: ${p.command}`),
    ...(c.site.command ? [`site: ${c.site.command}`] : []),
    ...Object.entries(c.env).map(([k, v]) => `env: ${k}=${v}`)
  ]
}

/** Fingerprint of the commands; changes whenever any of them (or env values) change. */
export function commandsHash(c: DevEnvironment): string {
  return createHash('sha256').update(JSON.stringify(autoRunCommands(c))).digest('hex').slice(0, 32)
}

/** Friendly progress label for a setup command ("composer install …" → "Installing PHP packages"). */
export function setupLabel(cmd: string, done = false): string {
  const c = cmd.trim()
  const pairs: [RegExp, string, string][] = [
    [/^composer install/, 'Installing PHP packages', 'PHP packages installed'],
    [/^(npm (ci|install)|pnpm install|yarn( install)?$|bun install)/, 'Installing JavaScript packages', 'JavaScript packages installed'],
    [/^(npm|pnpm|yarn|bun) run build/, 'Building the interface', 'Interface built'],
    [/^php artisan migrate/, 'Running migrations', 'Migrations ran'],
    [/^php artisan key:generate/, 'Generating the app key', 'App key generated'],
    [/php artisan storage:link/, 'Linking public storage', 'Public storage linked'],
    [/php artisan passport:keys/, 'Creating Passport keys', 'Passport keys ready'],
    [/php artisan db:seed/, 'Adding sample data', 'Sample data added']
  ]
  for (const [re, running, finished] of pairs) if (re.test(c)) return done ? finished : running
  const short = c.split('\n')[0].slice(0, 60)
  return done ? `${short} done` : `Running ${short}`
}
