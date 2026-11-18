import { app } from 'electron'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntegrationAction, IntegrationId, IntegrationStatus, Settings, WebServerStatus } from '@shared/types'
import { exec, run } from './exec'
import * as db from './db'
import * as mcp from './mcp'
import { PloiClient } from './ploi'

const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''

/**
 * Open Terminal.app running `script`. Using a .command file avoids needing
 * macOS Automation permission and lets the user watch / answer prompts.
 */
export async function openInTerminal(name: string, script: string): Promise<void> {
  const dir = join(app.getPath('userData'), 'scripts')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.command`)
  writeFileSync(
    file,
    `#!/bin/zsh -l\nclear\n${script}\necho\necho "✅ Finished. You can close this window and return to Software Factory."\n`
  )
  chmodSync(file, 0o755)
  await run('open', ['-a', 'Terminal', file])
}

async function claudeStatus(s: Settings): Promise<IntegrationStatus> {
  const bin = s.claudePath || 'claude'
  const base: IntegrationStatus = {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic’s coding agent',
    installed: false,
    signedIn: false,
    ready: false,
    optional: false,
    actions: ['install']
  }
  const v = await exec(bin, ['--version'], { timeoutMs: 15_000 })
  if (v.code !== 0) return { ...base, detail: 'Not installed' }
  const a = await exec(bin, ['auth', 'status'], { timeoutMs: 15_000 })
  let signedIn = false
  let account: string | undefined
  try {
    const j = JSON.parse(a.stdout)
    signedIn = !!j.loggedIn
    account = j.email || j.authMethod
  } catch {
    signedIn = a.code === 0
  }
  return {
    ...base,
    installed: true,
    signedIn,
    ready: signedIn,
    version: firstLine(v.stdout).replace(' (Claude Code)', ''),
    account,
    detail: signedIn ? undefined : 'Not signed in',
    actions: signedIn ? [] : ['login']
  }
}

async function codexStatus(s: Settings): Promise<IntegrationStatus> {
  const bin = s.codexPath || 'codex'
  const base: IntegrationStatus = {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI’s coding agent',
    installed: false,
    signedIn: false,
    ready: false,
    optional: true,
    actions: ['install']
  }
  const v = await exec(bin, ['--version'], { timeoutMs: 15_000 })
  if (v.code !== 0) {
    const text = (v.stderr || v.stdout).trim()
    // An npm install whose platform binary is missing still resolves `codex` but can't spawn.
    const broken = /ENOENT|vendor|Cannot find|MODULE_NOT_FOUND/.test(text)
    return broken
      ? { ...base, detail: 'Installed but broken — the native binary is missing', actions: ['repair'] }
      : { ...base, detail: 'Not installed' }
  }
  const l = await exec(bin, ['login', 'status'], { timeoutMs: 15_000 })
  const signedIn = l.code === 0
  return {
    ...base,
    installed: true,
    signedIn,
    ready: signedIn,
    version: firstLine(v.stdout),
    account: signedIn ? firstLine(l.stdout || l.stderr) : undefined,
    detail: signedIn ? undefined : 'Not signed in',
    actions: signedIn ? [] : ['login']
  }
}

async function githubStatus(): Promise<IntegrationStatus> {
  const base: IntegrationStatus = {
    id: 'github',
    name: 'GitHub',
    description: 'Pull requests, CI and merging via the gh CLI',
    installed: false,
    signedIn: false,
    ready: false,
    optional: false,
    actions: ['install']
  }
  const v = await exec('gh', ['--version'], { timeoutMs: 15_000 })
  if (v.code !== 0) return { ...base, detail: 'GitHub CLI not installed' }
  const a = await exec('gh', ['auth', 'status', '--json', 'hosts'], { timeoutMs: 15_000 })
  let login: string | undefined
  try {
    const hosts = JSON.parse(a.stdout).hosts?.['github.com'] as { login?: string; active?: boolean; state?: string }[] | undefined
    login = hosts?.find((h) => h.active && h.state === 'success')?.login
  } catch {
    login = undefined
  }
  return {
    ...base,
    installed: true,
    signedIn: !!login,
    ready: !!login,
    version: firstLine(v.stdout).replace('gh version ', ''),
    account: login,
    detail: login ? undefined : 'Not signed in',
    actions: login ? [] : ['login']
  }
}

async function herdStatus(): Promise<IntegrationStatus> {
  const v = await exec('herd', ['--version'], { timeoutMs: 15_000 })
  const ok = v.code === 0
  return {
    id: 'herd',
    name: 'Laravel Herd',
    description: 'Optional: serve sites through Herd instead of the built-in server',
    installed: ok,
    signedIn: null,
    ready: ok,
    optional: true,
    version: ok ? firstLine(v.stdout).replace('Herd ', '') : undefined,
    detail: ok ? undefined : 'Not installed',
    actions: ok ? [] : ['install']
  }
}

async function dbnginStatus(): Promise<IntegrationStatus> {
  const installed = db.dbnginInstalled()
  const services = installed ? (await db.dbnginServices()).filter((x) => x.kind !== 'redis') : []
  const running = services.filter((x) => x.running)
  return {
    id: 'dbngin',
    name: 'DBngin',
    description: 'A separate MySQL/Postgres database for every feature',
    installed,
    signedIn: null,
    ready: installed,
    optional: true,
    account: installed
      ? running.length
        ? `Running: ${running.map((x) => `${x.name} (${x.kind} :${x.port})`).join(', ')}`
        : `${services.length} service${services.length === 1 ? '' : 's'}, none running`
      : undefined,
    detail: installed ? undefined : 'Not installed — SQLite projects still get their own database file',
    actions: installed ? ['setup'] : ['install']
  }
}

async function ploiStatus(token: string | undefined): Promise<IntegrationStatus> {
  const base: IntegrationStatus = {
    id: 'ploi',
    name: 'Ploi',
    description: 'One-click deploys and deployment logs',
    installed: true,
    signedIn: false,
    ready: false,
    optional: true,
    actions: ['connect']
  }
  if (!token) return { ...base, detail: 'Not connected' }
  try {
    const servers = await new PloiClient(token).servers()
    return { ...base, signedIn: true, ready: true, account: `${servers.length} server${servers.length === 1 ? '' : 's'}`, actions: ['connect'] }
  } catch (e) {
    return { ...base, detail: (e as Error).message }
  }
}

async function nightwatchStatus(s: Settings): Promise<IntegrationStatus> {
  const st = await mcp.status(s).catch(() => [])
  const added = st.filter((m) => m.name === 'nightwatch' && m.installed).map((m) => (m.agent === 'claude' ? 'Claude' : 'Codex'))
  return {
    id: 'nightwatch',
    name: 'Nightwatch',
    description: 'Lets agents read and fix production issues',
    installed: true,
    signedIn: null,
    ready: added.length > 0,
    optional: true,
    account: added.length ? `Added to ${added.join(' & ')}` : undefined,
    detail: added.length ? undefined : 'Not added to your agents',
    actions: ['setup']
  }
}

function webServerCard(w?: WebServerStatus): IntegrationStatus {
  const base: IntegrationStatus = {
    id: 'webserver',
    name: 'Local HTTPS sites',
    description: 'Built-in web server: every change gets its own https://….localhost site',
    installed: true,
    signedIn: null,
    ready: false,
    optional: false,
    actions: []
  }
  if (!w?.running) return { ...base, detail: w?.error ? `Not running: ${w.error}` : 'Starting…' }
  return {
    ...base,
    ready: true,
    account: `HTTPS on :${w.httpsPort}${w.trusted ? ' · trusted by macOS' : ' · works in Spindle; trust it for Safari/Chrome'}${w.portNote ? ` · ${w.portNote}` : ''}`,
    actions: w.trusted ? [] : ['setup']
  }
}

export async function statuses(s: Settings, ploiToken: string | undefined, web?: WebServerStatus): Promise<IntegrationStatus[]> {
  return Promise.all([claudeStatus(s), codexStatus(s), githubStatus(), Promise.resolve(webServerCard(web)), herdStatus(), dbnginStatus(), ploiStatus(ploiToken), nightwatchStatus(s)])
}

/** Install / repair / sign-in run visibly in Terminal so the user can follow along and answer prompts. */
export async function action(s: Settings, id: IntegrationId, act: IntegrationAction): Promise<string> {
  const scripts: Partial<Record<`${IntegrationId}:${IntegrationAction}`, [string, string]>> = {
    'claude:install': ['curl -fsSL https://claude.ai/install.sh | bash', 'Installing Claude Code in Terminal…'],
    'claude:login': [`${s.claudePath || 'claude'} auth login`, 'Sign in to Claude in the Terminal window that opened.'],
    'codex:install': ['npm install -g @openai/codex@latest', 'Installing Codex in Terminal…'],
    'codex:repair': ['npm uninstall -g @openai/codex; npm install -g @openai/codex@latest', 'Reinstalling Codex in Terminal…'],
    'codex:login': [`${s.codexPath || 'codex'} login`, 'Sign in to Codex in the browser window that opens.'],
    'github:install': ['brew install gh && gh auth login --web --git-protocol https', 'Installing the GitHub CLI in Terminal…'],
    'github:login': ['gh auth login --web --git-protocol https', 'Follow the GitHub sign-in in Terminal.']
  }
  if (id === 'herd' && act === 'install') {
    await run('open', ['https://herd.laravel.com'])
    return 'Opened herd.laravel.com — install Herd, then come back.'
  }
  if (id === 'dbngin') {
    if (act === 'install') {
      await run('open', ['https://dbngin.com'])
      return 'Opened dbngin.com — install DBngin, then come back.'
    }
    await run('open', ['-a', 'DBngin'])
    return 'Opened DBngin — start the MySQL/Postgres service your projects use.'
  }
  if (id === 'nightwatch') {
    const msgs: string[] = []
    const st = await mcp.status(s)
    for (const agent of ['claude', 'codex'] as const) {
      const installedAgent = (await exec(agent === 'claude' ? s.claudePath || 'claude' : s.codexPath || 'codex', ['--version'])).code === 0
      if (!installedAgent || st.some((m) => m.name === 'nightwatch' && m.agent === agent && m.installed)) continue
      msgs.push(await mcp.install(s, 'nightwatch', agent))
    }
    return msgs.join(' ') || 'Nightwatch is already added to your agents.'
  }
  const entry = scripts[`${id}:${act}`]
  if (!entry) throw new Error(`Unsupported action ${act} for ${id}`)
  await openInTerminal(`${id}-${act}`, entry[0])
  return entry[1]
}
