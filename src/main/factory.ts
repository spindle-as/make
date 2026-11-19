import { app, BrowserWindow, Notification, session as eSession, shell as eShell } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  AgentKind,
  ChatItem,
  DeployResult,
  DeploymentInfo,
  DeployState,
  DevEnvironment,
  DevEnvView,
  AuthTarget,
  HarnessInfo,
  HarnessView,
  MainSiteState,
  PermissionDecision,
  Attachment,
  CheckResult,
  Events,
  Feature,
  FeatureStage,
  IntegrationAction,
  IntegrationId,
  NewFeatureInput,
  PloiSiteRef,
  Project,
  PullRequestInfo,
  ServiceDef,
  ToolHealth
} from '@shared/types'
import { ciGate } from '@shared/ci'
import { setEnvValue, slugFromPrompt, slugify, titleFromPrompt, truncate, uid } from '@shared/util'
import { AgentManager } from './agents'
import { exec, run, shell, shellQuote } from './exec'
import * as db from './db'
import * as git from './git'
import * as github from './github'
import * as herd from './herd'
import * as logs from './logs'
import * as mcp from './mcp'
import * as dbb from './dbbrowse'
import * as integrations from './integrations'
import { MailCatcher } from './mail'
import { freePort, LocalCA, PHP_ROUTER, siteHost, waitForPort, WebServer, type Site } from './webserver'
import { freshSetup, runSetup as runProjectSetup } from './projectsetup'
import * as review from './review'
import { catalog } from './models'
import { DeployTracker } from './deploy'
import { detectServices, ProcessManager } from './processes'
import * as devenv from './devenv'
import { AUTH_SCRIPT, runAuthScript, type AuthUser } from './laravelAuth'
import { expandCodexPrompt, harnessView } from './harness'
import { detectSetup, seederDoesSomething, setupContextFiles } from './detect'
import * as fast from './fastsetup'
import { listNode, listPhp, pick as pickRuntime, resolveRuntime, type ResolvedRuntime } from './runtimes'
import { environmentFromSite, PloiClient, scoreSites } from './ploi'
import { store } from './store'

type Emit = <K extends keyof Events>(channel: K, payload: Events[K]) => void

const STAGE_ORDER: FeatureStage[] = ['setup', 'coding', 'testing', 'pr', 'merged', 'deployed', 'archived']
const stageAtLeast = (s: FeatureStage, min: FeatureStage) => STAGE_ORDER.indexOf(s) >= STAGE_ORDER.indexOf(min)

export const DEFAULT_LARAVEL_SETUP = `# Runs inside every new worktree (cwd = worktree).
# Available env: $SF_MAIN_REPO $SF_WORKTREE $SF_BRANCH $SF_URL $SF_FEATURE
# .env is copied from the main checkout and APP_URL is pointed at the Herd URL before this runs.
set -e
if [ -f composer.json ]; then composer install --no-interaction --prefer-dist --no-progress; fi
if [ -f package.json ]; then
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund --no-package-lock; fi
  npm run build
fi
`

export const DEFAULT_NODE_SETUP = `# Runs inside every new worktree (cwd = worktree).
set -e
if [ -f package.json ]; then npm install --no-audit --no-fund; fi
`

/** Native notification, only when the user isn't already looking at the app. */
function notify(title: string, body: string): void {
  if (BrowserWindow.getFocusedWindow()) return
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
}

export class Factory {
  readonly agents: AgentManager
  readonly processes: ProcessManager
  readonly mail: MailCatcher
  private checksRunning = new Set<string>()
  private checksCancelled = new Set<string>()
  private checksCurrent = new Map<string, string>()
  readonly ca: LocalCA
  readonly web: WebServer
  private webError = ''
  readonly deploys: DeployTracker
  private deployRefreshTimer: NodeJS.Timeout | null = null

  /** copy-on-write cache of dependency folders and builds (see fastsetup.ts) */
  private setupCache = new fast.SetupCache(join(app.getPath('userData'), 'cache', 'setup'))

  constructor(private emit: Emit) {
    // Find or build the one-call folder cloner in the background, so the first setup can use it.
    void fast.ensureCloneHelper([join(process.resourcesPath ?? '', 'bin', 'clonedir')], join(app.getPath('userData'), 'bin'))
    this.ca = new LocalCA(join(app.getPath('userData'), 'certs'))
    this.web = new WebServer(this.ca, { ensureBackend: (site) => this.ensureSiteBackend(site) })
    this.mail = new MailCatcher(join(app.getPath('userData'), 'mail'), {
      onMail: (m) => this.emit('mail:received', m)
    })
    this.processes = new ProcessManager(join(app.getPath('userData'), 'process-logs'), {
      onChanged: (p) => this.emit('process:changed', p),
      onRemoved: (id, featureId) => this.emit('process:removed', { id, featureId }),
      onOutput: (id, featureId, stream, data) => this.emit('process:output', { id, featureId, stream, data })
    })
    this.deploys = new DeployTracker(
      {
        client: () => {
          const t = store().getSecret('ploi')
          return t ? new PloiClient(t) : null
        },
        save: (d) => store().setDeploy(d),
        changed: (d) => this.emit('deploy:changed', d),
        finished: (d) => this.onDeployFinished(d)
      },
      store().deploys()
    )
    this.agents = new AgentManager({
      onRequest: (req) => {
        this.emit('agent:request', req)
        this.updateBadge()
        let title = 'Agent'
        try {
          title = store().feature(req.featureId).title
        } catch {
          /* ignore */
        }
        notify(
          req.kind === 'question' ? `❓ ${title}` : `✋ ${title} needs your approval`,
          req.kind === 'question' ? truncate(req.detail, 160) : `${req.title}: ${truncate(req.detail, 140)}`
        )
      },
      onRequestResolved: (featureId, id) => {
        this.emit('agent:request-resolved', { featureId, id })
        this.updateBadge()
      },
      onItem: (featureId, item) => {
        store().upsertItem(featureId, item)
        this.emit('agent:item', { featureId, item })
      },
      onStatus: (s) => this.emit('agent:status', s),
      onSession: (featureId, sessionId) => {
        const f = store().feature(featureId)
        if (f.sessionId !== sessionId) this.saveFeature({ ...f, sessionId })
      },
      onCost: (featureId, cost) => {
        const f = store().feature(featureId)
        this.saveFeature({ ...f, costUsd: (f.costUsd ?? 0) + cost })
      },
      // Claude Code reports what it loaded (commands, skills, subagents, MCP) at the start of every turn.
      onInit: (featureId, init) => {
        const f = store().feature(featureId)
        if (!f.projectId) {
          this.globalHarness = { ...init, updatedAt: Date.now() }
          this.emit('harness:changed', { projectId: '' })
          return
        }
        this.updateProject(f.projectId, { harness: { ...init, updatedAt: Date.now() } })
        this.emit('harness:changed', { projectId: f.projectId })
      },
      onFinished: (featureId, ok) => {
        let f: Feature
        try {
          f = store().feature(featureId)
        } catch {
          return
        }
        if (f.kind === 'feature' && (f.stage === 'coding' || f.stage === 'setup')) this.saveFeature({ ...f, stage: 'testing' })
        const last = [...store().thread(featureId)].reverse().find((i) => i.role === 'assistant')
        notify(
          ok ? `✅ ${f.title}` : `⚠️ ${f.title}`,
          ok ? truncate(last?.text ?? (f.kind === 'feature' ? 'Agent finished — ready to test.' : 'Reply ready'), 180) : 'Agent stopped with an error.'
        )
      }
    })
  }

  // ---------------- helpers ----------------

  /** Dock badge = number of approvals/questions waiting on the user. */
  private updateBadge(): void {
    const n = this.agents.pending().length
    if (process.platform === 'darwin') app.dock?.setBadge(n ? String(n) : '')
  }

  private saveFeature(f: Feature): Feature {
    store().upsertFeature(f)
    this.emit('feature:changed', f)
    return f
  }

  private toast(kind: 'info' | 'success' | 'error', message: string): void {
    this.emit('toast', { kind, message })
  }

  private ploi(): PloiClient {
    const token = store().getSecret('ploi')
    if (!token) throw new Error('Add your Ploi API token in Settings first.')
    return new PloiClient(token)
  }

  private ctx(featureId: string): { f: Feature; p: Project | null } {
    const f = store().feature(featureId)
    return { f, p: f.projectId ? store().project(f.projectId) : null }
  }

  /** Like ctx, for operations that only make sense inside a project. */
  private fctx(featureId: string): { f: Feature; p: Project } {
    const { f, p } = this.ctx(featureId)
    if (!p) throw new Error('This conversation is not attached to a project.')
    return { f, p }
  }

  private requireRepo(p: Project): string {
    if (!p.githubRepo) throw new Error(`${p.name} has no GitHub remote. Set "GitHub repo" in project settings.`)
    return p.githubRepo
  }

  private addSystemItem(featureId: string, text: string, role: ChatItem['role'] = 'system'): void {
    this.putItem(featureId, { id: uid('sys'), role, text, ts: Date.now() })
  }

  private putItem(featureId: string, item: ChatItem): void {
    store().upsertItem(featureId, item)
    this.emit('agent:item', { featureId, item })
  }

  // ---------------- integrations / models ----------------

  async integrations() {
    return integrations.statuses(store().getSettings(), store().getSecret('ploi'), await this.webServerStatus())
  }

  async integrationAction(id: IntegrationId, action: IntegrationAction) {
    if (id === 'webserver') {
      await this.ca.trustInSystem()
      return 'Spindle’s local certificate is now trusted — sites open with a padlock in Safari and Chrome too.'
    }
    return integrations.action(store().getSettings(), id, action)
  }

  /** Validate a Ploi token before saving it, so a typo never gets stored. */
  async connectPloi(token: string): Promise<{ servers: number; sites: number }> {
    if (store().getSettings().restricted) throw new Error('Production access is turned off on this machine.')
    const t = token.trim()
    if (!t) {
      await store().setSecret('ploi', '')
      this.emit('settings:changed', store().getSettings())
      return { servers: 0, sites: 0 }
    }
    const sites = await new PloiClient(t).allSites()
    const servers = new Set(sites.map((x) => x.serverId)).size || (await new PloiClient(t).servers()).length
    await store().setSecret('ploi', t)
    this.ploiSiteCache = null
    this.emit('settings:changed', store().getSettings())
    return { servers, sites: sites.length }
  }

  private ploiSiteCache: { at: number; sites: PloiSiteRef[] } | null = null

  async ploiAllSites(): Promise<PloiSiteRef[]> {
    if (this.ploiSiteCache && Date.now() - this.ploiSiteCache.at < 120_000) return this.ploiSiteCache.sites
    const sites = await this.ploi().allSites()
    this.ploiSiteCache = { at: Date.now(), sites }
    return sites
  }

  async suggestPloiSites(projectId: string): Promise<PloiSiteRef[]> {
    return scoreSites(await this.ploiAllSites(), store().project(projectId))
  }

  linkPloiSite(projectId: string, ref: PloiSiteRef): Project {
    const p = store().project(projectId)
    if (p.environments.some((e) => e.ploiSiteId === ref.siteId)) return p
    const env = environmentFromSite(ref, p.defaultBranch, p.environments)
    return this.updateProject(projectId, { environments: [...p.environments, env] })
  }

  listModels() {
    return catalog()
  }

  // ---------------- health ----------------

  async checkTools(): Promise<ToolHealth[]> {
    const s = store().getSettings()
    const v = async (name: string, cmd: string, args: string[]): Promise<ToolHealth> => {
      const r = await exec(cmd, args, { timeoutMs: 15_000 })
      const out = (r.stdout || r.stderr).trim().split('\n')[0]
      return r.code === 0 ? { name, ok: true, version: out } : { name, ok: false, detail: truncate(out || `not found (${cmd})`, 200) }
    }
    const checks = await Promise.all([
      v('Claude Code', s.claudePath || 'claude', ['--version']),
      v('Codex', s.codexPath || 'codex', ['--version']),
      v('git', 'git', ['--version']),
      v('Herd', 'herd', ['--version']),
      (async (): Promise<ToolHealth> => {
        const r = await exec('gh', ['auth', 'status'], { timeoutMs: 15_000 })
        const text = (r.stdout + r.stderr).trim()
        const acct = text.match(/account (\S+)/)?.[1]
        return r.code === 0
          ? { name: 'GitHub CLI', ok: true, version: acct ? `logged in as ${acct}` : 'authenticated' }
          : { name: 'GitHub CLI', ok: false, detail: 'Run `gh auth login` in a terminal' }
      })(),
      (async (): Promise<ToolHealth> => {
        if (!store().getSecret('ploi')) return { name: 'Ploi', ok: false, detail: 'No API token configured' }
        try {
          const servers = await this.ploi().servers()
          return { name: 'Ploi', ok: true, version: `${servers.length} server(s)` }
        } catch (e) {
          return { name: 'Ploi', ok: false, detail: (e as Error).message }
        }
      })()
    ])
    return checks
  }

  // ---------------- projects ----------------

  async addProject(path: string): Promise<Project> {
    if (!(await git.isGitRepo(path))) throw new Error(`${path} is not a git repository`)
    const root = await git.repoRoot(path)
    const existing = store().projects().find((p) => p.path === root)
    if (existing) return existing
    const isLaravel = existsSync(join(root, 'artisan'))
    const name = basename(root)
    let slug = slugify(name, 24)
    const taken = new Set(store().projects().map((p) => p.slug))
    for (let i = 2; taken.has(slug); i++) slug = `${slugify(name, 20)}-${i}`
    const quick = isLaravel
      ? ['php artisan test', 'php artisan migrate', 'composer install', 'npm run build', 'php artisan optimize:clear']
      : existsSync(join(root, 'package.json'))
        ? ['npm test', 'npm run build', 'npm install']
        : []
    const p: Project = {
      id: uid('p_'),
      name,
      slug,
      path: root,
      defaultBranch: await git.defaultBranch(root),
      githubRepo: await git.githubRepo(root),
      isLaravel,
      herdEnabled: false, // the built-in HTTPS server is the default; Herd can be chosen per project
      server: 'spindle',
      herdSecure: true,
      setupScript: isLaravel ? DEFAULT_LARAVEL_SETUP : DEFAULT_NODE_SETUP,
      quickCommands: quick,
      services: detectServices(root, db.readEnv(root)),
      captureMail: true,
      defaultAgent: 'claude',
      database: db.describeProjectDb(root) ? { mode: 'clone', migrate: isLaravel } : { mode: 'shared', migrate: false },
      environments: [],
      createdAt: Date.now()
    }
    store().upsertProject(p)
    this.syncEnvMirror(p.id) // a cloned repo may already describe its environment in .spindle/
    this.emit('project:changed', store().project(p.id))
    void this.autoLinkPloi(p.id)
    void this.refreshAccess(p.id).catch(() => {})
    return p
  }

  // ---------------- built-in web server ----------------

  /** Start the HTTPS server and register every known site. Called once at app start. */
  async startWebServer(): Promise<void> {
    try {
      writeFileSync(this.routerFile(), PHP_ROUTER)
      writeFileSync(this.authScript(), AUTH_SCRIPT)
      await this.web.start()
      // Changes previewed with the old `artisan serve` fallback move onto HTTPS domains.
      for (const f of store().features()) {
        const p = f.projectId ? store().projects().find((x) => x.id === f.projectId) : undefined
        if (p && !f.sitePort && !f.cleanedUp && /^http:\/\/127\.0\.0\.1:\d+/.test(f.localUrl ?? '') && p.server !== 'herd') {
          await this.registerFeatureSite(f.id)
        }
      }
      for (const p of store().projects()) {
        if (!p.sitePort && (p.server ?? (p.herdEnabled ? 'herd' : 'spindle')) === 'spindle' && existsSync(p.path)) await this.registerProjectSite(p.id).catch(() => false)
      }
      for (const f of store().features()) if (f.sitePort && !f.cleanedUp) this.web.register(this.featureSite(f))
      for (const p of store().projects()) if (p.sitePort) this.web.register(this.projectSite(p))
      // URLs embed the port, which can change (e.g. Herd took 443); keep them current.
      for (const f of store().features()) {
        if (!f.sitePort || f.cleanedUp) continue
        const url = this.web.url(this.featureSite(f).host)
        if (f.localUrl !== url) this.saveFeature({ ...f, localUrl: url })
      }
      for (const p of store().projects()) {
        if (!p.sitePort) continue
        const url = this.web.url(this.projectSite(p).host)
        if (p.localUrl !== url) this.updateProject(p.id, { localUrl: url })
      }
    } catch (e) {
      this.webError = (e as Error).message
    }
  }

  private authScript(): string {
    return join(app.getPath('userData'), 'spindle-auth.php')
  }

  /** The app a "log in as" acts on, with the env (pinned PHP) to run it in. */
  private authContext(target: AuthTarget): { root: string; env: Record<string, string> } {
    const f = 'featureId' in target ? store().feature(target.featureId) : null
    const p = store().project(f ? f.projectId! : (target as { projectId: string }).projectId)
    const root = f && !f.inPlace && existsSync(f.worktreePath) ? f.worktreePath : p.path
    if (!existsSync(join(root, 'artisan'))) throw new Error('“Log in as” works for Laravel apps.')
    if (!existsSync(this.authScript())) writeFileSync(this.authScript(), AUTH_SCRIPT)
    return { root, env: this.execEnv(this.runnable(p, f)) }
  }

  async authUsers(target: AuthTarget, query = ''): Promise<{ total: number; users: AuthUser[] }> {
    const { root, env } = this.authContext(target)
    return runAuthScript(this.authScript(), root, ['list', query], env)
  }

  /** Start a real Laravel session for the user and hand its cookie to the preview's cookie jar. */
  async loginAs(target: AuthTarget, userId: string, partition: string, url: string) {
    const { root, env } = this.authContext(target)
    const r = await runAuthScript<{ cookie: { name: string; value: string; path: string; httpOnly: boolean; sameSite: string; lifetimeMinutes: number }; user: { id: string; name: string | null; email: string | null }; home: string }>(
      this.authScript(),
      root,
      ['login', userId],
      env
    )
    const origin = new URL(url).origin
    const jar = eSession.fromPartition(partition).cookies
    await jar.set({
      url: origin + '/',
      name: r.cookie.name,
      value: r.cookie.value,
      path: r.cookie.path,
      httpOnly: r.cookie.httpOnly,
      secure: origin.startsWith('https:'),
      sameSite: r.cookie.sameSite === 'strict' ? 'strict' : r.cookie.sameSite === 'none' ? 'no_restriction' : 'lax',
      expirationDate: Math.floor(Date.now() / 1000) + r.cookie.lifetimeMinutes * 60
    })
    return { home: r.home, user: r.user }
  }

  async logoutPreview(partition: string, url: string): Promise<void> {
    const origin = new URL(url).origin
    const jar = eSession.fromPartition(partition).cookies
    for (const c of await jar.get({ url: origin + '/' })) await jar.remove(origin + '/', c.name)
  }

  private routerFile(): string {
    return join(app.getPath('userData'), 'php-router.php')
  }

  private featureSite(f: Feature): Site {
    const p = store().project(f.projectId!)
    return { host: siteHost(p.slug, f.slug), root: f.worktreePath, docroot: docrootOf(f.worktreePath, this.envOf(p, f).config), port: f.sitePort!, owner: f.id }
  }

  private projectSite(p: Project): Site {
    return { host: siteHost(p.slug), root: p.path, docroot: docrootOf(p.path, this.envOf(p).config), port: p.sitePort!, owner: `project:${p.id}` }
  }

  private siteFor(featureId: string): Site | undefined {
    const f = store().feature(featureId)
    return f.sitePort && f.projectId && !f.cleanedUp ? this.featureSite(f) : undefined
  }

  async registerFeatureSite(featureId: string): Promise<string> {
    let f = store().feature(featureId)
    if (!f.sitePort) {
      f = this.saveFeature({ ...f, sitePort: await freePort(18000 + Math.floor(Math.random() * 2000)) })
    }
    const site = this.featureSite(f)
    this.web.register(site)
    const url = this.web.url(site.host)
    this.saveFeature({ ...store().feature(featureId), localUrl: url })
    return url
  }

  /** Main checkout site for a project (used by first-time project setup). */
  async registerProjectSite(projectId: string): Promise<string | false> {
    let p = store().project(projectId)
    if (!this.web.httpsPort || !servable(p.path, this.envOf(p).config)) return false
    if (!p.sitePort) p = this.updateProject(projectId, { sitePort: await freePort(17000 + Math.floor(Math.random() * 1000)) })
    const site = this.projectSite(p)
    this.web.register(site)
    const url = this.web.url(site.host)
    this.updateProject(projectId, { localUrl: url })
    return url
  }

  /** Start (if needed) the PHP backend behind a site and wait until it accepts connections. */
  private async ensureSiteBackend(site: Site): Promise<void> {
    const running = this.processes.list(site.owner).find((x) => x.name === 'Web server' && x.status === 'running')
    if (running && (await waitForPort(site.port, 100))) return
    const owner = site.owner.startsWith('project:') ? null : store().feature(site.owner)
    const p = store().project(owner ? owner.projectId! : site.owner.slice('project:'.length))
    const r = this.runnable(p, owner)
    const custom = r.config.site.command
    if (!running && (await waitForPort(site.port, 150))) {
      // The port is held by something else — usually a backend left behind by a crashed run, possibly
      // with an old PHP version. Move this site to a free port rather than talk to a stranger.
      site.port = await freePort(site.port + 1)
      if (owner) this.saveFeature({ ...store().feature(owner.id), sitePort: site.port })
      else this.updateProject(p.id, { sitePort: site.port })
      this.web.register(site)
    }
    if (!running) {
      const env = { ...this.procEnv(r), PORT: String(site.port), HOST: '127.0.0.1', SPINDLE_DOCROOT: site.docroot }
      if (custom) {
        // e.g. a Node app: "npm run preview -- --port $PORT"; Spindle still terminates HTTPS in front of it.
        this.processes.start(site.owner, 'Web server', custom, 'service', site.root, env)
      } else {
        const php = existsSync(join(site.root, 'artisan')) || existsSync(join(site.docroot, 'index.php'))
        if (!php && !existsSync(join(site.docroot, 'index.html'))) throw new Error('Nothing to serve: no public/index.php or index.html (set a docroot or site command in .spindle/config.json).')
        this.processes.start(site.owner, 'Web server', `php -S 127.0.0.1:${site.port} -t ${shellQuote(site.docroot)} ${shellQuote(this.routerFile())}`, 'service', site.root, {
          ...env,
          PHP_CLI_SERVER_WORKERS: '4'
        })
      }
    }
    if (!(await waitForPort(site.port, custom ? 60_000 : 15_000))) throw new Error(`The ${custom ? 'site command' : 'PHP server'} did not start — see the Processes tab.`)
  }

  async webServerStatus() {
    const holder = this.web.httpsPort && this.web.httpsPort !== 443 ? await exec('lsof', ['-nP', '-iTCP:443', '-sTCP:LISTEN']) : null
    const owner = holder?.stdout.split('\n')[1]?.split(/\s+/)[0]
    return {
      running: !!this.web.httpsPort,
      httpsPort: this.web.httpsPort,
      httpPort: this.web.httpPort,
      trusted: this.web.httpsPort ? await this.ca.trustedBySystem().catch(() => false) : false,
      sites: this.web.list().map((x) => ({ host: x.host, url: this.web.url(x.host), owner: x.owner })),
      portNote: this.web.httpsPort && this.web.httpsPort !== 443 ? `Port 443 is in use${owner ? ` by ${owner.replace(/-arm.*/, '')}` : ''}, so sites use :${this.web.httpsPort}.` : undefined,
      error: this.webError || undefined
    }
  }

  trustCertificates() {
    return this.ca.trustInSystem()
  }

  // ---------------- access ----------------

  async refreshAccess(projectId: string) {
    const p = store().project(projectId)
    const settings = store().getSettings()
    const access = p.githubRepo
      ? await github.repoAccess(p.githubRepo, settings.restricted)
      : { role: 'unknown' as const, canPush: false, canMerge: false, canDeploy: false, checkedAt: Date.now(), detail: 'No GitHub remote' }
    this.updateProject(projectId, { access })
    return access
  }

  /** Cached access, re-checked when stale (or always, for sensitive actions). */
  private async ensureAccess(p: Project, fresh = false) {
    const restricted = store().getSettings().restricted
    if (!fresh && p.access && Date.now() - p.access.checkedAt < 10 * 60_000) {
      return { ...p.access, canMerge: p.access.canMerge && !restricted, canDeploy: p.access.canDeploy && !restricted }
    }
    return this.refreshAccess(p.id)
  }

  refreshAllAccess(): void {
    for (const p of store().projects()) void this.refreshAccess(p.id).catch(() => {})
  }

  // ---------------- open / create projects ----------------

  githubRepos(query?: string) {
    return github.listRepos(query)
  }

  private uniqueDir(name: string): string {
    const root = store().getSettings().projectsRoot
    mkdirSync(root, { recursive: true })
    let dir = join(root, name)
    for (let i = 2; existsSync(dir); i++) dir = join(root, `${name}-${i}`)
    return dir
  }

  async openGithubRepo(nameWithOwner: string): Promise<Project> {
    const existing = store().projects().find((p) => p.githubRepo?.toLowerCase() === nameWithOwner.toLowerCase())
    if (existing) return existing
    const dir = this.uniqueDir(nameWithOwner.split('/')[1])
    await run('gh', ['repo', 'clone', nameWithOwner, dir], { timeoutMs: 10 * 60_000 })
    const p = await this.addProject(dir)
    void this.prepareProject(p.id)
    return p
  }

  async createLaravelProject(name: string): Promise<Project> {
    const slug = slugify(name, 40)
    const dir = this.uniqueDir(slug)
    const r = await exec('composer', ['create-project', 'laravel/laravel', dir, '--prefer-dist', '--no-interaction'], { timeoutMs: 15 * 60_000, env: { COMPOSER_NO_INTERACTION: '1' } })
    if (r.code !== 0) throw new Error(`Creating the Laravel project failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`)
    await run('git', ['init', '-b', 'main'], { cwd: dir })
    await run('git', ['add', '-A'], { cwd: dir })
    await exec('git', ['commit', '-m', 'Initial commit'], { cwd: dir })
    const p = await this.addProject(dir)
    this.updateProject(p.id, { name })
    // Created by Spindle → describe its environment in the repo right away (and trust it).
    this.saveDevEnv(p.id, this.envOf(store().project(p.id)).config, '')
    await exec('git', ['add', '.spindle'], { cwd: dir })
    await exec('git', ['commit', '-m', 'Add Spindle development environment'], { cwd: dir })
    void this.prepareProject(p.id)
    return store().project(p.id)
  }

  /** First-time setup of the main checkout, with friendly progress and resume-on-retry. */
  async prepareProject(projectId: string): Promise<void> {
    const p = store().project(projectId)
    const state = p.setup && p.setup.status !== 'done' ? p.setup : freshSetup()
    this.syncEnvMirror(projectId)
    const r = this.runnable(store().project(projectId))
    await runProjectSetup(p, state, { mailPort: this.mail.port, capture: r.config.mail.capture, env: this.execEnv(r), php: r.runtime.php?.version, prepare: r.config.prepare, seed: r.config.database.seed, site: () => this.registerProjectSite(projectId) }, (setup, patch) => {
      this.updateProject(projectId, { setup: { ...setup, steps: setup.steps.map((x) => ({ ...x })) }, ...(patch ?? {}) })
    })
  }

  // ---------------- mail ----------------

  /** Feature workspaces have their own inbox; chats share the project's main checkout inbox. */
  mailKey(featureId: string): string {
    const { f } = this.ctx(featureId)
    return f.kind === 'feature' && !f.inPlace ? f.id : `project:${f.projectId}`
  }

  // ---------------- database browser ----------------

  private dbDir(featureId: string): { dir: string; editable: boolean } {
    const { f } = this.ctx(featureId)
    if (f.cleanedUp) throw new Error('This workspace was cleaned up.')
    // Changes are only allowed in a feature's own workspace — never in the main checkout's database.
    return { dir: f.worktreePath, editable: f.kind === 'feature' && !f.inPlace }
  }

  async dbTables(featureId: string) {
    const { dir, editable } = this.dbDir(featureId)
    return { ...(await dbb.tables(dir)), editable }
  }

  dbRows(featureId: string, table: string, page: number) {
    return dbb.rows(this.dbDir(featureId).dir, table, page)
  }

  dbQuery(featureId: string, sql: string, allowWrite: boolean) {
    const { dir, editable } = this.dbDir(featureId)
    if (allowWrite && !editable) throw new Error('Changes are only allowed in a feature’s own database, not the main project database.')
    return dbb.query(dir, sql, allowWrite)
  }

  private snapDir() {
    return join(app.getPath('userData'), 'snapshots')
  }

  dbSnapshots(featureId: string) {
    return dbb.listSnapshots(this.snapDir(), featureId)
  }

  dbSnapshot(featureId: string, label: string) {
    return dbb.snapshot(this.dbDir(featureId).dir, this.snapDir(), featureId, label)
  }

  async dbRestore(featureId: string, id: string) {
    const { dir, editable } = this.dbDir(featureId)
    if (!editable) throw new Error('Restoring is only allowed in a feature’s own database.')
    await dbb.restore(dir, this.snapDir(), featureId, id)
  }

  async dbReset(featureId: string): Promise<string> {
    const { dir, editable } = this.dbDir(featureId)
    if (!editable) throw new Error('Resetting is only allowed in a feature’s own database.')
    const { f, p } = this.ctx(featureId)
    const proc = this.processes.start(featureId, 'Reset data', 'php artisan migrate:fresh --seed --force', 'command', dir, p ? this.procEnv(this.runnable(p, f)) : {})
    const done = await this.processes.wait(proc.id)
    if (done.code !== 0) throw new Error('Resetting the data failed — see the Processes tab.')
    return 'Data reset: fresh structure with sample data.'
  }

  // ---------------- review ----------------

  async checkChanges(featureId: string) {
    const { f, p } = this.fctx(featureId)
    if (this.checksRunning.has(featureId)) throw new Error('Checks are already running.')
    const runEnv = this.procEnv(this.runnable(p, f))
    const defs = review.detectChecks(f.worktreePath)
    if (!defs.length) throw new Error('No checks found for this project (no tests, linters or build script).')
    this.checksRunning.add(featureId)
    const results: CheckResult[] = []
    const plan = defs.map((d) => ({ name: d.name, command: d.command }))
    const startedAt = Date.now()
    this.checksCancelled.delete(featureId)
    this.emit('checks:changed', { featureId, running: true, results, plan, startedAt })
    try {
      for (const def of defs) {
        if (this.checksCancelled.has(featureId)) break
        const t0 = Date.now()
        const proc = this.processes.start(featureId, `Check: ${def.name}`, def.command, 'command', f.worktreePath, { ...runEnv, APP_ENV: 'testing' })
        this.checksCurrent.set(featureId, proc.id)
        this.emit('checks:changed', { featureId, running: true, results: [...results], plan, startedAt, current: { name: def.name, command: def.command, processId: proc.id, startedAt: t0 } })
        const done = await this.processes.wait(proc.id)
        if (this.checksCancelled.has(featureId)) break
        const out = this.processes.output(proc.id)
        results.push({ name: def.name, command: def.command, ok: done.code === 0, code: done.code ?? null, at: Date.now(), durationMs: Date.now() - t0, summary: out.split('\n').slice(-30).join('\n') })
        this.emit('checks:changed', { featureId, running: true, results: [...results], plan, startedAt })
      }
    } finally {
      this.checksRunning.delete(featureId)
      this.checksCurrent.delete(featureId)
    }
    if (this.checksCancelled.has(featureId)) {
      this.checksCancelled.delete(featureId)
      this.addSystemItem(featureId, `Checks stopped after ${results.length} of ${plan.length}.`)
      this.emit('checks:changed', { featureId, running: false, results, plan, startedAt, cancelled: true })
      return results
    }
    const cur = store().feature(featureId)
    this.saveFeature({ ...cur, checks: [...(cur.checks ?? []), ...results].slice(-30) })
    const failed = results.filter((r) => !r.ok)
    this.addSystemItem(featureId, failed.length ? `Checks: ${results.length - failed.length} passed, ${failed.length} need fixing (${failed.map((x) => x.name).join(', ')})` : `Checks: all ${results.length} passed`, failed.length ? 'error' : 'system')
    this.emit('checks:changed', { featureId, running: false, results, plan, startedAt })
    return results
  }

  /** Stop a running "Check changes": the current check is killed and the rest are skipped. */
  async cancelChecks(featureId: string): Promise<void> {
    if (!this.checksRunning.has(featureId)) return
    this.checksCancelled.add(featureId)
    const id = this.checksCurrent.get(featureId)
    if (id) await this.processes.stop(id)
  }

  async draftPr(featureId: string): Promise<{ title: string; body: string }> {
    const { f, p } = this.fctx(featureId)
    const facts = await review.gatherFacts(f)
    const thread = store().thread(featureId)
    const narrative = await review.writeNarrative(store().getSettings().claudePath || 'claude', f, p, facts, thread)
    const last = [...thread].reverse().find((i) => i.role === 'assistant')?.text ?? ''
    return { title: narrative?.title || f.title, body: review.composeBody(store().feature(featureId), facts, narrative, last) }
  }

  addVisualNote(featureId: string, note: string): void {
    const f = store().feature(featureId)
    this.saveFeature({ ...f, visualNotes: [...(f.visualNotes ?? []), note].slice(-30) })
  }

  /** If Ploi is connected and exactly one site clearly matches the project, link it automatically. */
  private async autoLinkPloi(projectId: string): Promise<void> {
    if (!store().getSecret('ploi')) return
    try {
      const ranked = (await this.suggestPloiSites(projectId)).filter((s) => (s.score ?? 0) >= 10)
      const prod = ranked.filter((s) => !/(^|[.-])(staging|stage|test|dev|preview)([.-]|$)/.test(s.domain))
      if (prod.length !== 1) return
      const linked = this.linkPloiSite(projectId, prod[0])
      for (const st of ranked.filter((s) => s !== prod[0] && s.serverId === prod[0].serverId).slice(0, 1)) this.linkPloiSite(projectId, st)
      this.toast('success', `Linked ${linked.name} to Ploi site ${prod[0].domain}`)
    } catch {
      /* best effort */
    }
  }

  updateProject(id: string, patch: Partial<Project>): Project {
    const p = { ...store().project(id), ...patch, id }
    store().upsertProject(p)
    this.emit('project:changed', p)
    return p
  }

  // ---------------- features ----------------

  async createFeature(input: NewFeatureInput): Promise<Feature> {
    const s = store().getSettings()
    const kind = input.kind ?? 'feature'
    const p = input.projectId ? store().project(input.projectId) : null
    if (kind === 'feature' && !p) throw new Error('Pick a project for a feature — or start a plain chat instead.')
    const prompt = input.prompt?.trim() ?? ''
    const explicitTitle = input.title?.trim()
    const title = explicitTitle || (prompt ? titleFromPrompt(prompt) : kind === 'chat' ? 'New chat' : 'New feature')
    const siblings = store().features().filter((f) => f.projectId === (p?.id ?? null))
    let slug = explicitTitle ? slugFromPrompt(explicitTitle) : prompt ? slugFromPrompt(prompt) : kind
    const takenSlugs = new Set(siblings.map((f) => f.slug))
    for (let i = 2; takenSlugs.has(slug); i++) slug = `${slugify(slug, 28)}-${i}`
    const agent: AgentKind = input.agent ?? p?.defaultAgent ?? 'claude'
    const id = uid('f_')
    const now = Date.now()
    const common = {
      id,
      projectId: p?.id ?? null,
      title,
      titleLocked: !!explicitTitle,
      slug,
      agent,
      model: input.model,
      effort: input.effort,
      createdAt: now,
      updatedAt: now
    }

    let f: Feature
    if (kind === 'chat') {
      const cwd = p ? p.path : join(app.getPath('userData'), 'chats', id)
      mkdirSync(cwd, { recursive: true })
      f = {
        ...common,
        kind: 'chat',
        branch: p ? await git.currentBranch(p.path) : '',
        baseBranch: p?.defaultBranch ?? '',
        worktreePath: cwd,
        inPlace: true,
        permissionMode: input.permissionMode ?? 'default',
        stage: 'coding',
        setupStatus: 'ok'
      }
    } else {
      const inPlace = !!input.inPlace
      const proj = p!
      let branch = inPlace ? await git.currentBranch(proj.path) : `${s.branchPrefix}${slug}`
      if (!inPlace) {
        const exists = await exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: proj.path })
        if (exists.code === 0) branch = `${branch}-${Date.now().toString(36).slice(-4)}`
      }
      f = {
        ...common,
        kind: 'feature',
        branch,
        baseBranch: input.baseBranch || proj.defaultBranch,
        worktreePath: inPlace ? proj.path : join(s.worktreeRoot, proj.slug, slug),
        inPlace,
        permissionMode: input.permissionMode ?? s.defaultPermissionMode,
        stage: 'setup',
        setupStatus: 'running',
        setupLog: ''
      }
    }
    this.saveFeature(f)
    const shots = input.attachments?.length ?? 0
    if (prompt) store().upsertItem(f.id, { id: uid('u'), role: 'user', text: prompt + (shots ? `\n\n📎 ${shots} screenshot${shots > 1 ? 's' : ''} attached` : ''), ts: Date.now() })
    if (prompt && !explicitTitle) void this.generateTitle(f.id, prompt)

    const kickoff = () => {
      if (!prompt) return
      try {
        if (this.agents.isRunning(f.id)) return
        this.startAgent(f.id, prompt, false, input.attachments ?? [])
      } catch (e) {
        this.addSystemItem(f.id, `Could not start the agent: ${(e as Error).message}`, 'error')
      }
    }
    if (kind === 'chat') kickoff()
    // Worktree + dependencies + Herd happen in the background; the thread opens immediately.
    else
      void this.runSetup(f.id).then((ok) => {
        if (ok || store().feature(f.id).setupStatus !== 'failed' || existsSync(f.worktreePath)) kickoff()
      })
    return f
  }

  /** Ask a small model for a crisp 3–6 word title; silently keeps the heuristic one on failure. */
  private async generateTitle(featureId: string, prompt: string): Promise<void> {
    const s = store().getSettings()
    const r = await exec(s.claudePath || 'claude', ['-p', '--output-format', 'text', '--model', 'haiku', '--effort', 'low'], {
      input:
        'You name tasks. Do NOT carry out or answer the task below — only give it a short descriptive title ' +
        '(3 to 6 words, sentence case, no quotes, no trailing period).\n\n<task>\n' +
        truncate(prompt, 4000) +
        '\n</task>\n\nReply with the title only and do not use any tools.',
      timeoutMs: 45_000,
      cwd: app.getPath('temp')
    })
    const title = r.stdout.trim().split('\n')[0]?.replace(/^["'#*\s]+|["'.*\s]+$/g, '')
    if (r.code !== 0 || !title || title.length > 80 || title.split(/\s+/).length < 2) return
    try {
      const f = store().feature(featureId)
      if (!f.titleLocked) this.saveFeature({ ...f, title })
    } catch {
      /* archived meanwhile */
    }
  }

  /** Start a feature from a chat, carrying the discussion over as context. */
  async promoteToFeature(chatId: string): Promise<Feature> {
    const { f, p } = this.fctx(chatId)
    const lines: string[] = []
    for (const i of store().thread(chatId)) {
      if (i.role === 'user') lines.push(`User: ${i.text}`)
      else if (i.role === 'assistant') lines.push(`Assistant: ${i.text}`)
    }
    let transcript = lines.join('\n\n')
    if (transcript.length > 16_000) transcript = '…' + transcript.slice(-16_000)
    const prompt = [
      `We discussed this in a separate chat about ${p.name}:`,
      '',
      '<discussion>',
      transcript,
      '</discussion>',
      '',
      'Implement what we agreed on in that discussion. Follow the existing conventions and add or update tests.'
    ].join('\n')
    const feature = await this.createFeature({
      kind: 'feature',
      projectId: p.id,
      title: f.title,
      prompt,
      agent: f.agent,
      model: f.model,
      effort: f.effort
    })
    this.addSystemItem(chatId, `Continued as a feature: “${feature.title}” on ${feature.branch}`)
    return feature
  }

  private appendSetupLog(featureId: string, text: string): void {
    const f = store().feature(featureId)
    const log = ((f.setupLog ?? '') + text).slice(-60_000)
    this.saveFeature({ ...f, setupLog: log })
  }

  async runSetup(featureId: string): Promise<boolean> {
    let { f, p } = this.fctx(featureId)
    if (f.kind === 'chat') return true
    this.saveFeature({ ...f, setupStatus: 'running', setupLog: f.setupLog ? f.setupLog + '\n--- re-running setup ---\n' : '' })
    const log = (t: string) => this.appendSetupLog(featureId, t.endsWith('\n') ? t : t + '\n')
    // A compact, live checklist in the conversation; the full output stays in the Setup tab.
    const steps: string[] = []
    const cardId = `setup-${featureId}-${Date.now().toString(36)}`
    const card = (status: ChatItem['status'], current?: string) =>
      this.putItem(featureId, {
        id: cardId,
        role: 'system',
        status,
        text: [...steps, ...(current ? [`… ${current}`] : [])].join('\n'),
        ts: Date.now()
      })
    const step = (line: string) => {
      steps.push(line)
      card('running')
    }
    let ok = true
    try {
      // 0. The worktree itself (created here so the thread opens instantly)
      if (!f.inPlace && !existsSync(f.worktreePath)) {
        card('running', `Creating worktree on ${f.branch} from ${f.baseBranch}`)
        mkdirSync(join(f.worktreePath, '..'), { recursive: true })
        await git.addWorktree(p.path, f.worktreePath, f.branch, f.baseBranch)
        log(`✓ Worktree created at ${f.worktreePath}`)
        step(`✓ Worktree ready on ${f.branch}`)
      } else if (f.inPlace) {
        step(`✓ Working directly in the main checkout on ${f.branch}`)
      }
      // Until this branch edits its own .spindle/config.json, it follows the main checkout's live file
      // (so settings edited in Spindle apply right away, without copying files into the change's diff).
      if (!f.inPlace && store().feature(featureId).envBaseHash === undefined) {
        f = this.saveFeature({ ...store().feature(featureId), envBaseHash: devenv.fileHash(f.worktreePath) })
      }
      const r = this.runnable(p, f)
      if (r.parseError) step(`✗ ${r.parseError} — using detected defaults`)
      if (!r.trusted) {
        step('⚠ .spindle/config.json has commands you haven’t approved yet — they were skipped. Review them in the Setup tab.')
        log(['Skipped until approved:', ...r.pending.map((c) => `  ${c}`)].join('\n'))
      }
      for (const m of this.runtimeWarnings(r.config, existsSync(join(f.worktreePath, 'vendor')) ? f.worktreePath : p.path)) step(`⚠ ${m}`)
      if (r.runtime.php || r.runtime.node) {
        log(`✓ Runtime: ${[r.runtime.php && `PHP ${r.runtime.php.version} (${r.runtime.php.source})`, r.runtime.node && `Node ${r.runtime.node.version} (${r.runtime.node.source})`].filter(Boolean).join(', ')}`)
      }
      const runEnv = this.execEnv(r)
      // 1. .env from the main checkout (it is git-ignored, so worktrees don't get it)
      if (!f.inPlace) {
        const src = join(p.path, '.env')
        const dst = join(f.worktreePath, '.env')
        if (existsSync(src) && !existsSync(dst)) {
          copyFileSync(src, dst)
          log('✓ Copied .env from main checkout')
        } else if (!existsSync(dst) && existsSync(join(f.worktreePath, '.env.example'))) {
          copyFileSync(join(f.worktreePath, '.env.example'), dst)
          log('✓ Created .env from .env.example')
        }
        // Development email never leaves the machine: it lands in this feature's Email tab.
        if (r.config.mail.capture && this.mail.port && db.captureMailEnv(f.worktreePath, this.mail.port, featureId)) {
          log(`✓ Email captured by Spindle (SMTP 127.0.0.1:${this.mail.port})`)
          step('✓ Email is captured in Spindle — nothing reaches real inboxes')
        }
        const extra = Object.entries(r.config.env)
        const envFile = join(f.worktreePath, '.env')
        if (extra.length) {
          let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
          for (const [k, v] of extra) text = setEnvValue(text, k, v)
          writeFileSync(envFile, text)
          log(`✓ .env: ${extra.map(([k]) => k).join(', ')} set from .spindle`)
        }
      }
      // 2. Herd site
      if (p.herdEnabled && !f.inPlace) {
        const site = slugify(`${p.slug}-${f.slug}`, 60)
        try {
          const php = r.runtime.php?.version ?? (await herd.phpFor(p.path))
          const url = await herd.link(f.worktreePath, site, p.herdSecure, php)
          f = store().feature(featureId)
          this.saveFeature({ ...f, herdSite: site, localUrl: url })
          log(`✓ Herd site linked: ${url}${php ? ` (PHP ${php})` : ''}`)
          step(`✓ Local site ${url}`)
          const envFile = join(f.worktreePath, '.env')
          if (existsSync(envFile)) {
            writeFileSync(envFile, setEnvValue(readFileSync(envFile, 'utf8'), 'APP_URL', url))
            log('✓ APP_URL updated in .env')
          }
        } catch (e) {
          log(`✗ Herd link failed: ${(e as Error).message}`)
          step('✗ Herd link failed — see the Setup tab')
        }
      } else if (!f.inPlace && this.web.httpsPort && servable(f.worktreePath, r.config)) {
        // Spindle's built-in HTTPS server: https://<change>.<project>.localhost
        const url = await this.registerFeatureSite(featureId)
        f = store().feature(featureId)
        const envFile = join(f.worktreePath, '.env')
        if (existsSync(envFile)) writeFileSync(envFile, setEnvValue(readFileSync(envFile, 'utf8'), 'APP_URL', url))
        log(`✓ Site ${url}`)
        step(`✓ Your preview: ${url}`)
      } else if (p.herdEnabled && f.inPlace) {
        const site = (await herd.sites()).find((s) => s.path === p.path)
        if (site) {
          f = store().feature(featureId)
          this.saveFeature({ ...f, herdSite: site.site, localUrl: site.url })
          log(`✓ Using existing Herd site ${site.url}`)
        }
      }
      // 3–6, as fast as possible: the database, PHP packages and JavaScript packages are prepared at
      // the same time, builds start as soon as the JavaScript packages are in, and dependency folders
      // and builds are cloned (copy-on-write) instead of rebuilt whenever an identical one exists.
      if (!f.inPlace) {
        f = store().feature(featureId)
        const wt = f.worktreePath
        const t0 = Date.now()
        const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
        const active = new Set<string>()
        const doing = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
          active.add(label)
          card('running', [...active].join(' · '))
          try {
            return await fn()
          } finally {
            active.delete(label)
            card('running', [...active].join(' · ') || undefined)
          }
        }
        const cmdEnv = { ...runEnv, SF_MAIN_REPO: p.path, SF_WORKTREE: wt, SF_BRANCH: f.branch, SF_URL: f.localUrl ?? '', SF_FEATURE: f.slug, CI: '1' }
        const adjust = (cmd: string) => {
          let c = cmd
          // `npm ci` needs a committed lockfile; a branch without one gets a normal install instead of a failure.
          if (/^npm ci\b/.test(c) && !existsSync(join(wt, 'package-lock.json'))) {
            c = c.replace(/^npm ci\b/, 'npm install')
            log('No package-lock.json in this branch — using npm install instead of npm ci')
          }
          // Use the local package cache first instead of asking the registry about every package.
          if (/^npm (ci|install|i)\b/.test(c) && !/--prefer-(offline|online)/.test(c)) c += ' --prefer-offline'
          // Without a committed lockfile, don't write one: it would show up as a change nobody made.
          if (/^npm (install|i)\b/.test(c) && !existsSync(join(wt, 'package-lock.json')) && !/--no-package-lock/.test(c)) c += ' --no-package-lock'
          return c
        }
        const runCmd = async (cmd: string, env: Record<string, string> = cmdEnv): Promise<boolean> => {
          const c = adjust(cmd)
          log(`$ ${c}`)
          const started = Date.now()
          const code = await doing(devenv.setupLabel(c), () => this.streamSetupCommand(featureId, c, wt, env))
          if (code !== 0) {
            log(`✗ ${c} exited with code ${code}`)
            step(`✗ ${devenv.setupLabel(c)} failed (exit ${code}) — see the Setup tab`)
            return false
          }
          step(`✓ ${devenv.setupLabel(c, true)} (${secs(Date.now() - started)})`)
          return true
        }

        // Own database (DBngin MySQL/Postgres, or a separate SQLite file)
        const database = async () => {
          const dbMode = r.config.database.mode
          if (dbMode !== 'shared' && !store().feature(featureId).database) {
            await doing(dbMode === 'clone' ? 'Copying the database' : 'Creating a database', async () => {
              const started = Date.now()
              try {
                const created = await db.provision(p.path, wt, db.featureDbName(p.slug, f.slug), dbMode, log)
                if (created) {
                  this.saveFeature({ ...store().feature(featureId), database: created })
                  step(`✓ Own database ${created.driver === 'sqlite' ? '(SQLite file)' : created.name} (${secs(Date.now() - started)})`)
                }
              } catch (e) {
                log(`✗ Database: ${(e as Error).message}`)
                step(`✗ Database: ${(e as Error).message}`)
              }
            })
          } else if (dbMode === 'shared') {
            // Sharing SQLite means using the main checkout's file — the worktree has none of its own.
            const shared = db.shareSqlite(p.path, wt)
            if (shared) {
              log(`✓ Uses the main SQLite database at ${shared}`)
              step('✓ Shares the main database')
            }
          }
        }

        // Dependencies: clone an identical installed folder when there is one, install otherwise.
        const install = async (cmd: string): Promise<boolean> => {
          const kind = fast.installKind(cmd)!
          const dst = join(wt, kind.dir)
          const hash = fast.depKey(kind, wt)
          if (hash && !existsSync(dst)) {
            const cached = this.setupCache.get(p.id, kind.dir, hash)
            const source = cached ?? (fast.canReuse(kind, p.path, wt) ? join(p.path, kind.dir) : null)
            if (source) {
              const started = Date.now()
              const how = await doing(devenv.setupLabel(cmd), () => fast.cloneDir(source, dst))
              if (how) {
                // Tool caches can hold absolute paths of the folder they came from.
                if (kind.dir === 'node_modules') for (const c of ['.vite', '.cache']) rmSync(join(dst, c), { recursive: true, force: true })
                log(`✓ ${kind.dir} reused from ${cached ? 'an earlier change' : 'the main checkout'} (${how}, ${secs(Date.now() - started)})`)
                step(`✓ ${devenv.setupLabel(cmd, true)} (reused, ${secs(Date.now() - started)})`)
                if (!cached) void this.setupCache.put(p.id, kind.dir, hash, dst).catch(() => {})
                return true
              }
            }
            // Composer installs incrementally: start from the main checkout's packages, fetch only the difference.
            if (kind.manager === 'composer' && existsSync(join(p.path, 'vendor'))) {
              const how = await fast.cloneDir(join(p.path, 'vendor'), dst)
              if (how) log(`Started from the main checkout's vendor/ (${how}); composer installs only what differs`)
            }
          }
          const good = await runCmd(cmd)
          if (good && hash) void this.setupCache.put(p.id, kind.dir, hash, dst).catch(() => {})
          return good
        }

        // Builds: reuse an earlier build of exactly the same inputs (Laravel/Vite's public/build).
        const build = async (cmd: string): Promise<boolean> => {
          const out = join(wt, 'public', 'build')
          const key = p.isLaravel ? await fast.buildKey(wt) : null
          const cached = key ? this.setupCache.get(p.id, 'build', key) : null
          if (cached && !existsSync(out)) {
            const started = Date.now()
            if (await fast.cloneDir(cached, out)) {
              log(`✓ public/build reused from an earlier build of the same code`)
              step(`✓ ${devenv.setupLabel(cmd, true)} (reused, ${secs(Date.now() - started)})`)
              return true
            }
          }
          const good = await runCmd(cmd)
          if (good && key && existsSync(out)) void this.setupCache.put(p.id, 'build', key, out).catch(() => {})
          return good
        }

        const plan = fast.planSetup(r.config.setup)
        for (const c of plan.before) {
          if (!(await runCmd(c))) {
            ok = false
            break
          }
        }
        if (ok) {
          const js = plan.installs.find((c) => fast.installKind(c)!.dir === 'node_modules')
          const jsReady = js ? install(js) : Promise.resolve(true)
          // Builds only need the JavaScript packages: they run alongside migrations and the rest.
          const builds = jsReady.then(async (good) => {
            if (!good) return false
            for (const b of plan.builds) if (!(await build(b))) return false
            return true
          })
          const [, phpOk, jsOk] = await Promise.all([
            database(),
            Promise.all(plan.installs.filter((c) => c !== js).map(install)).then((rs) => rs.every(Boolean)),
            jsReady
          ])
          ok = phpOk && jsOk
          for (const c of ok ? plan.after : []) {
            if (!(await runCmd(c))) {
              ok = false
              break
            }
          }
          // Migrations against the feature's own database
          const fd = store().feature(featureId).database
          if (ok && fd && r.trusted && p.isLaravel && r.config.database.migrate && existsSync(join(wt, 'artisan'))) {
            // A brand-new database gets sample data when the seeders do something (or the config says so).
            const seed = r.config.database.mode === 'empty' && (r.config.database.seed ?? seederDoesSomething(wt))
            const started = Date.now()
            const m = await doing('Running migrations', () => exec('php', ['artisan', 'migrate', '--force', ...(seed ? ['--seed'] : [])], { cwd: wt, env: runEnv, timeoutMs: 10 * 60_000 }))
            log(m.stdout + m.stderr)
            step(m.code === 0 ? `✓ Migrations ran${seed ? ' and database seeded' : ''} (${secs(Date.now() - started)})` : '✗ Migrations failed — see the Setup tab')
          }
          // After the database is ready: storage link, package keys, custom seeders…
          if (ok && r.trusted && r.config.prepare?.length) {
            for (const cmd of r.config.prepare) await runCmd(cmd, { ...runEnv, SF_WORKTREE: wt, SF_MAIN_REPO: p.path })
          }
          ok = (await builds) && ok
        }
        log(`${ok ? '✓' : '✗'} Setup ${ok ? 'finished' : 'stopped'} in ${secs(Date.now() - t0)}`)
        if (ok) step(`✓ Ready in ${secs(Date.now() - t0)}`)
      }
    } catch (e) {
      ok = false
      log(`✗ ${(e as Error).message}`)
      step(`✗ ${(e as Error).message.split('\n')[0]}`)
    }
    // Long-running dev processes (npm run dev, queue worker…) start once the workspace is usable.
    // Warm up the site's backend so the first preview is instant.
    const site = this.siteFor(featureId)
    if (site) void this.ensureSiteBackend(site).catch(() => {})
    if (ok) {
      const started = this.servicesFor(p, f).filter((x) => x.autoStart)
      if (started.length) {
        this.autoStartServices(featureId)
        steps.push(`✓ Started ${started.map((x) => x.name).join(', ')}`)
      }
    }
    card(ok ? 'ok' : 'error')
    f = store().feature(featureId)
    this.saveFeature({ ...f, setupStatus: ok ? 'ok' : 'failed', stage: f.stage === 'setup' ? 'coding' : f.stage })
    return ok
  }

  async archiveFeature(featureId: string, opts: { removeWorktree: boolean; deleteBranch: boolean }): Promise<void> {
    const { f, p } = this.ctx(featureId)
    this.agents.stop(featureId)
    await this.processes.removeFeature(featureId)
    if (f.sitePort && f.projectId) this.web.unregister(this.featureSite(f).host)
    if (f.kind === 'chat' && !p) rmSync(f.worktreePath, { recursive: true, force: true })
    if (p && f.kind === 'feature' && !f.inPlace && !f.cleanedUp) {
      if (opts.removeWorktree) await this.cleanupFeature(featureId, 'archive', opts.deleteBranch)
      else if (f.herdSite) await herd.unlink(f.worktreePath, f.herdSite)
    }
    store().removeFeature(featureId)
    this.emit('feature:removed', { id: featureId })
  }

  /**
   * Tear down everything a feature provisioned — Herd site, database, worktree and
   * (optionally) the local branch — but keep the thread so its history stays readable.
   */
  async cleanupFeature(featureId: string, reason: 'shipped' | 'manual' | 'archive', deleteBranch = true): Promise<void> {
    const { f, p } = this.fctx(featureId)
    if (f.kind !== 'feature' || f.inPlace || f.cleanedUp) return
    this.agents.stop(featureId)
    await this.processes.removeFeature(featureId)
    if (f.sitePort && f.projectId) this.web.unregister(this.featureSite(f).host)
    const done: string[] = []
    const problems: string[] = []
    if (f.herdSite) {
      await herd.unlink(f.worktreePath, f.herdSite).catch((e) => problems.push(`Herd: ${e.message}`))
      done.push('Herd site unlinked')
    }
    if (f.database?.created) {
      try {
        await db.drop(p.path, f.database)
        if (f.database.driver !== 'sqlite') done.push(`database ${f.database.name} dropped`)
      } catch (e) {
        problems.push(`Database: ${(e as Error).message}`)
      }
    }
    try {
      await git.removeWorktree(p.path, f.worktreePath)
      done.push('worktree removed')
      if (deleteBranch) {
        await git.deleteBranch(p.path, f.branch)
        done.push(`local branch ${f.branch} deleted`)
      }
    } catch (e) {
      problems.push(`Worktree: ${(e as Error).message}`)
    }
    if (reason === 'archive') return
    const next = store().feature(featureId)
    this.saveFeature({ ...next, cleanedUp: problems.length === 0, herdSite: undefined, localUrl: undefined })
    const what = done.length ? done.join(', ') : 'nothing to clean'
    this.addSystemItem(featureId, `${reason === 'shipped' ? 'Shipped — cleaned up' : 'Cleaned up'}: ${what}.`)
    if (problems.length) this.addSystemItem(featureId, `Cleanup problems:\n${problems.join('\n')}`, 'error')
  }

  /** After merge (and deploy, when an environment auto-deploys the base branch), free the feature's resources. */
  private maybeCleanupAfterShip(featureId: string, phase: 'merged' | 'deployed'): void {
    if (!store().getSettings().cleanupAfterShip) return
    let f: Feature
    try {
      f = store().feature(featureId)
    } catch {
      return
    }
    const p = f.projectId ? store().project(f.projectId) : null
    if (!p) return
    const waitsForDeploy = p.environments.some((e) => e.autoDeployOnMerge && e.branch === f.baseBranch && e.ploiSiteId)
    if (phase === 'merged' && waitsForDeploy) return
    void this.cleanupFeature(featureId, 'shipped').catch((e) => this.toast('error', `Cleanup failed: ${e.message}`))
  }

  // ---------------- agent ----------------

  /** Slash commands, subagents, skills and MCP servers for the composer's menus. */
  harness(projectId: string | null, agent: AgentKind): HarnessView {
    const p = projectId ? store().project(projectId) : null
    return harnessView(agent, p?.path ?? null, p ? p.harness : this.globalHarness)
  }

  private globalHarness?: HarnessInfo

  sendPrompt(featureId: string, prompt: string, attachments: Attachment[] = []): void {
    // While Claude is working, a new message joins the running turn instead of failing.
    if (this.agents.isRunning(featureId)) {
      if (!this.agents.canQueue(featureId)) throw new Error('Codex is still working — wait for it to finish or stop it first.')
      this.agents.queueMessage(featureId, prompt, attachments)
      this.putItem(featureId, { id: uid('u'), role: 'user', text: prompt + (attachments.length ? `\n\n📎 ${attachments.length} screenshot(s) attached` : ''), ts: Date.now() })
      return
    }
    this.startAgent(featureId, prompt, true, attachments)
  }

  pendingRequests() {
    return this.agents.pending()
  }

  respondPermission(featureId: string, requestId: string, decision: PermissionDecision, message?: string): void {
    const req = this.agents.pending().find((r) => r.id === requestId)
    this.agents.respondPermission(featureId, requestId, decision, message)
    // An approved plan switches the session to auto-edit (Claude Code does the same via setMode).
    if (decision === 'approve-plan') this.saveFeature({ ...store().feature(featureId), permissionMode: 'acceptEdits' })
    if (req) {
      const verb = decision === 'deny' ? 'Declined' : decision === 'allow-always' ? 'Always allowed' : decision === 'approve-plan' ? 'Plan approved — building it' : 'Allowed'
      this.addSystemItem(featureId, `${verb}: ${req.title}${message ? ` — “${truncate(message, 120)}”` : ''}`)
    }
  }

  answerQuestion(featureId: string, requestId: string, answers: Record<string, string>): void {
    this.agents.answerQuestion(featureId, requestId, answers)
  }

  // ---------------- the main version ----------------

  private mainFetchedAt = new Map<string, number>()
  private mainRefreshing = new Set<string>()

  /**
   * The project's main version — always running at its own address and kept current, so new
   * changes can start from it (browse it, point at things, start a change from those notes).
   * Updates only fast-forward a clean checkout of the main branch; anything else is left alone.
   */
  async mainSite(projectId: string): Promise<MainSiteState> {
    const p = store().project(projectId)
    if (!existsSync(p.path)) throw new Error(`The project folder ${p.path} is missing.`)
    const branch = await git.currentBranch(p.path)
    const dirty = (await exec('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: p.path })).stdout.trim() !== ''
    let updated = 0
    let note: string | undefined
    if (branch !== p.defaultBranch) note = `The main checkout is on ${branch}, not ${p.defaultBranch}, so it isn’t updated automatically.`
    else if (dirty) note = 'The main checkout has uncommitted changes, so it isn’t updated automatically.'
    else if (p.githubRepo && Date.now() - (this.mainFetchedAt.get(p.id) ?? 0) > 60_000) {
      this.mainFetchedAt.set(p.id, Date.now())
      const before = (await exec('git', ['rev-parse', 'HEAD'], { cwd: p.path })).stdout.trim()
      const fetched = await exec('git', ['fetch', '--quiet', 'origin', p.defaultBranch], { cwd: p.path, timeoutMs: 60_000 })
      if (fetched.code === 0) {
        const ff = await exec('git', ['merge', '--ff-only', '--quiet', `origin/${p.defaultBranch}`], { cwd: p.path, timeoutMs: 60_000 })
        const after = (await exec('git', ['rev-parse', 'HEAD'], { cwd: p.path })).stdout.trim()
        if (ff.code !== 0) note = `Couldn’t fast-forward ${p.defaultBranch} (it has local commits).`
        else if (after !== before) {
          updated = Number((await exec('git', ['rev-list', '--count', `${before}..${after}`], { cwd: p.path })).stdout.trim()) || 1
          const files = (await exec('git', ['diff', '--name-only', before, after], { cwd: p.path })).stdout.split('\n').filter(Boolean)
          void this.refreshMain(p.id, files, updated)
        }
      }
    }
    let url = p.localUrl
    if ((p.server ?? (p.herdEnabled ? 'herd' : 'spindle')) !== 'herd') {
      const u = await this.registerProjectSite(p.id)
      if (u) url = u
      const site = this.projectSite(store().project(p.id))
      this.clearStaleHot(p.path)
      await this.ensureSiteBackend(site).catch((e) => {
        note = (e as Error).message
      })
    }
    return { url, branch, defaultBranch: p.defaultBranch, dirty, updated, refreshing: this.mainRefreshing.has(p.id), note }
  }

  /** A leftover public/hot (Vite dev server no longer running) makes every page load broken assets. */
  private clearStaleHot(root: string): void {
    const hot = join(root, 'public', 'hot')
    if (!existsSync(hot)) return
    const port = Number(readFileSync(hot, 'utf8').match(/:(\d+)/)?.[1])
    void waitForPort(port || 5173, 200).then((up) => {
      if (!up) rmSync(hot, { force: true })
    })
  }

  /** After pulling, bring dependencies, assets and the database up to date — only what changed. */
  private async refreshMain(projectId: string, files: string[], commits: number): Promise<void> {
    if (this.mainRefreshing.has(projectId)) return
    this.mainRefreshing.add(projectId)
    const p = store().project(projectId)
    const owner = `project:${p.id}`
    const env = this.procEnv(this.runnable(p))
    const changed = (re: RegExp) => files.some((f) => re.test(f))
    const steps: [string, string][] = []
    if (changed(/^composer\.(json|lock)$/) && existsSync(join(p.path, 'composer.json'))) steps.push(['Update PHP packages', 'composer install --no-interaction --prefer-dist --no-progress'])
    const pkg = existsSync(join(p.path, 'package.json'))
    if (pkg && changed(/^package(-lock)?\.json$|^pnpm-lock\.yaml$|^yarn\.lock$/)) steps.push(['Update JavaScript packages', existsSync(join(p.path, 'package-lock.json')) ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund'])
    if (pkg && existsSync(join(p.path, 'public', 'build')) && changed(/^(resources|vite\.config|tailwind\.config|postcss\.config|package)/)) steps.push(['Build assets', 'npm run build'])
    if (existsSync(join(p.path, 'artisan')) && changed(/^database\/migrations\//)) steps.push(['Run migrations', 'php artisan migrate --force'])
    try {
      for (const [name, command] of steps) {
        const proc = this.processes.start(owner, `Main: ${name}`, command, 'command', p.path, env)
        const done = await this.processes.wait(proc.id)
        if (done.code !== 0) {
          this.toast('error', `Updating the main version: “${name}” failed — see its output in the project’s processes.`)
          break
        }
      }
    } finally {
      this.mainRefreshing.delete(projectId)
    }
    this.emit('main:updated', { projectId, commits })
  }

  // ---------------- development environment (.spindle) ----------------

  private runtimeRoot(): string {
    return join(app.getPath('userData'), 'runtimes')
  }

  /** What a project without a .spindle file runs with: its saved settings, or detected defaults. */
  private fallbackEnv(p: Project): DevEnvironment {
    const detected = devenv.detect(p.path, db.readEnv(p.path), !!db.describeProjectDb(p.path))
    const script = p.setupScript?.trim() ?? ''
    const isDefault = !script || script === DEFAULT_LARAVEL_SETUP.trim() || script === DEFAULT_NODE_SETUP.trim()
    return devenv.fromLegacy(p, detected, isDefault)
  }

  /** The environment of a project, or of one of its changes (a worktree's own copy wins, so a branch can change it). */
  envOf(p: Project, f?: Feature | null) {
    const own =
      !!f && !f.inPlace && f.projectId === p.id && existsSync(devenv.configPath(f.worktreePath)) && (f.envBaseHash === undefined || devenv.fileHash(f.worktreePath) !== f.envBaseHash)
    const root = own ? f.worktreePath : p.path
    const loaded = devenv.load(root, this.fallbackEnv(p))
    const hash = devenv.commandsHash(loaded.config)
    // Nothing from the repo runs until approved here; a broken file falls back to safe detected values.
    const trusted = loaded.source === 'detected' || !!loaded.parseError || (p.trustedEnvHashes ?? []).includes(hash)
    return { ...loaded, hash, trusted, instructions: devenv.readInstructions(root) }
  }

  /** What may run unattended: an unapproved file contributes no commands, auto-starts or env values. */
  private runnable(p: Project, f?: Feature | null) {
    const e = this.envOf(p, f)
    const config: DevEnvironment = e.trusted
      ? e.config
      : { ...e.config, setup: [], prepare: [], processes: e.config.processes.map((x) => ({ ...x, autoStart: false })), site: { docroot: e.config.site.docroot }, env: {} }
    const runtime: ResolvedRuntime = resolveRuntime(config.runtime, this.runtimeRoot())
    return { ...e, config, runtime, missing: runtime.missing, pending: e.trusted ? [] : devenv.autoRunCommands(e.config) }
  }

  /** Env for processes (the login shell re-reads the profile, so PATH is prefixed inside it). */
  private procEnv(r: ReturnType<Factory['runnable']>): Record<string, string> {
    return { ...r.config.env, ...(r.runtime.path.length ? { SPINDLE_PATH: r.runtime.path.join(':') } : {}) }
  }

  /** Env for direct spawns (setup steps, migrations, the agent): pinned runtimes first on PATH. */
  private execEnv(r: ReturnType<Factory['runnable']>): Record<string, string> {
    return { ...r.config.env, ...(r.runtime.path.length ? { PATH: [...r.runtime.path, process.env.PATH ?? ''].join(':') } : {}) }
  }

  /** Context for the agent: pinned runtimes and the team's notes on how the project works. */
  private envNote(r: ReturnType<Factory['runnable']>): string {
    return [
      r.runtime.php ? `This project uses PHP ${r.runtime.php.version}; it is first on PATH (${join(r.runtime.php.dir, 'php')}).` : '',
      r.runtime.node ? `This project uses Node ${r.runtime.node.version}; it is first on PATH (${r.runtime.node.dir}).` : '',
      'The development environment (setup steps, background processes, runtime versions, .env values) is defined in .spindle/config.json. If this work needs a new process or setup step, edit that file and tell the user — Spindle asks them to approve new commands.',
      r.instructions.trim() ? `How this project works, from the team (.spindle/instructions.md):\n<project-notes>\n${truncate(r.instructions.trim(), 12_000)}\n</project-notes>` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** Keep the project's cached copies (terminal quick commands, processes, database mode) in step with the file. */
  private syncEnvMirror(projectId: string): void {
    const p = store().project(projectId)
    if (!existsSync(p.path)) return
    const { config } = this.envOf(p)
    const patch: Partial<Project> = { services: config.processes, quickCommands: config.commands, database: config.database, captureMail: config.mail.capture }
    const same = JSON.stringify([p.services, p.quickCommands, p.database, p.captureMail !== false]) === JSON.stringify([patch.services, patch.quickCommands, patch.database, patch.captureMail])
    if (!same) this.updateProject(projectId, patch)
  }

  syncAllEnvMirrors(): void {
    for (const p of store().projects()) {
      try {
        this.syncEnvMirror(p.id)
      } catch {
        /* a broken checkout shouldn't block startup */
      }
    }
  }

  devEnv(projectId: string, featureId?: string): DevEnvView {
    if (!featureId) this.syncEnvMirror(projectId)
    const p = store().project(projectId)
    const f = featureId ? store().feature(featureId) : null
    const e = this.envOf(p, f)
    const php = listPhp(this.runtimeRoot())
    const node = listNode()
    return {
      config: e.config,
      source: e.source,
      file: devenv.configPath(e.root),
      instructions: e.instructions,
      trusted: e.trusted,
      hash: e.hash,
      commands: e.trusted ? [] : devenv.autoRunCommands(e.config),
      parseError: e.parseError,
      runtime: {
        php: e.config.runtime.php ? pickRuntime(php, e.config.runtime.php) : undefined,
        node: e.config.runtime.node ? pickRuntime(node, e.config.runtime.node) : undefined
      },
      installed: { php, node },
      hints: devenv.runtimeHints(e.root),
      ...(({ suggestions, reasons }) => ({ suggestions: suggestions.filter((x) => ![...e.config.setup, ...(e.config.prepare ?? [])].includes(x.command)), reasons }))(detectSetup(e.root)),
      warnings: this.runtimeWarnings(e.config, e.root)
    }
  }

  /** Write .spindle/ in the main checkout. Edits made here are the user's own, so they're approved. */
  saveDevEnv(projectId: string, config: DevEnvironment, instructions?: string, baseHash?: string): DevEnvView {
    const p = store().project(projectId)
    // Never overwrite (and thereby approve) commands someone else put in the file after the editor opened.
    const current = this.envOf(p)
    if (baseHash && current.source === 'file' && !current.parseError && current.hash !== baseHash) {
      throw new Error('.spindle/config.json changed on disk since you opened it (a pull or an edit elsewhere). Close and reopen the settings to see the new version.')
    }
    devenv.write(p.path, config, instructions)
    const hash = this.envOf(p).hash
    this.updateProject(projectId, { trustedEnvHashes: [...new Set([...(p.trustedEnvHashes ?? []), hash])].slice(-20) })
    return this.devEnv(projectId)
  }

  /**
   * Let Claude read the project (read-only: plan mode, no shell, no edits) and propose how it runs.
   * The result is a proposal for the user to review in the editor — nothing is saved or run here.
   */
  async aiDetectDevEnv(projectId: string): Promise<{ config: DevEnvironment; notes: string }> {
    const p = store().project(projectId)
    const current = this.envOf(p).config
    const s = store().getSettings()
    const prompt = [
      'Work out how this project runs in local development. Read whatever helps — start with: ' + setupContextFiles(p.path).join(', ') + '.',
      'Use only read tools. Do not run commands or change files.',
      'Then reply with ONLY a JSON object (no prose, no code fence) shaped like:',
      '{"setup": string[], "prepare": string[], "migrate": boolean, "seed": boolean, "processes": [{"name": string, "command": string, "autoStart": boolean}], "commands": string[], "runtime": {"php"?: string, "node"?: string}, "env": {[key: string]: string}, "notes": string}',
      'setup = install/build commands for a fresh checkout, in order (never servers or watchers).',
      'prepare = commands to run after the database exists and is migrated (e.g. php artisan storage:link, key generation for packages, specific seeders).',
      'migrate/seed = whether a new database should be migrated / seeded with sample data.',
      'processes = long-running dev processes (asset dev server, queue worker, scheduler…), autoStart for the ones a developer always needs.',
      'commands = handy one-off commands (tests, linters, cache clearing).',
      'env = only non-secret .env values local development needs that differ from .env.example.',
      'Never include commands that copy .env or generate the APP_KEY — Spindle handles those. Never include secrets.',
      'notes = 2–4 plain sentences on what you found and why.'
    ].join('\n')
    const r = await exec(
      s.claudePath || 'claude',
      ['-p', '--output-format', 'json', '--model', s.claudeModel || 'sonnet', '--permission-mode', 'plan', '--allowedTools', 'Read,Glob,Grep,LS', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch'],
      { cwd: p.path, input: prompt, timeoutMs: 5 * 60_000 }
    )
    if (r.code !== 0) throw new Error(`Claude couldn’t analyse the project: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`)
    let text = r.stdout
    try {
      text = (JSON.parse(r.stdout) as { result?: string }).result ?? r.stdout
    } catch {
      /* plain text */
    }
    const raw = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    let found: Record<string, any>
    try {
      found = JSON.parse(raw)
    } catch {
      throw new Error('Claude’s answer wasn’t valid JSON — try again.')
    }
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined)
    const config: DevEnvironment = devenv.normalize(
      {
        ...current,
        setup: strs(found.setup) ?? current.setup,
        prepare: strs(found.prepare) ?? current.prepare,
        processes: Array.isArray(found.processes) ? found.processes : current.processes,
        commands: strs(found.commands) ?? current.commands,
        runtime: { ...current.runtime, ...(found.runtime && typeof found.runtime === 'object' ? found.runtime : {}) },
        env: { ...current.env, ...(found.env && typeof found.env === 'object' ? found.env : {}) },
        database: { ...current.database, migrate: typeof found.migrate === 'boolean' ? found.migrate : current.database.migrate, seed: typeof found.seed === 'boolean' ? found.seed : current.database.seed }
      },
      current
    )
    return { config, notes: typeof found.notes === 'string' ? found.notes : '' }
  }

  detectDevEnv(projectId: string): DevEnvironment {
    const p = store().project(projectId)
    return devenv.detect(p.path, db.readEnv(p.path), !!db.describeProjectDb(p.path))
  }

  /** Approve the commands currently in a .spindle file, then bring up what was held back. */
  trustDevEnv(projectId: string, featureId?: string): DevEnvView {
    const p = store().project(projectId)
    const f = featureId ? store().feature(featureId) : null
    const e = this.envOf(p, f)
    if (e.parseError) throw new Error(e.parseError)
    this.updateProject(projectId, { trustedEnvHashes: [...new Set([...(p.trustedEnvHashes ?? []), e.hash])].slice(-20) })
    for (const x of store().features()) {
      if (x.projectId === projectId && (!featureId || x.id === featureId)) {
        try {
          this.ensureServices(x.id)
        } catch {
          /* not ready */
        }
      }
    }
    return this.devEnv(projectId, featureId)
  }

  /** Pinned versions that aren't installed, or are older than the installed packages need. */
  private runtimeWarnings(config: DevEnvironment, root: string): string[] {
    const r = resolveRuntime(config.runtime, this.runtimeRoot())
    const min = devenv.phpMinimum(root)
    const tooOld = r.php && min && devenv.belowMinimum(r.php.version, min) ? [`PHP ${r.php.version} is too old for this project’s installed packages — they need ${min} or newer.`] : []
    return [...r.missing, ...tooOld]
  }

  /** Run one setup command, streaming its output into the change's setup log. */
  private streamSetupCommand(featureId: string, cmd: string, cwd: string, env: Record<string, string>): Promise<number | null> {
    return new Promise((resolve) => {
      const child = spawn(process.env.SHELL || '/bin/zsh', ['-c', cmd], { cwd, env: { ...process.env, ...env } })
      let pending = ''
      let timer: NodeJS.Timeout | null = null
      const flush = () => {
        if (pending) this.appendSetupLog(featureId, pending)
        pending = ''
        timer = null
      }
      const onData = (d: Buffer) => {
        pending += d.toString()
        if (!timer) timer = setTimeout(flush, 300)
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('error', (e) => {
        pending += String(e)
      })
      child.on('close', (c) => {
        if (timer) clearTimeout(timer)
        flush()
        resolve(c)
      })
    })
  }

  // ---------------- services ----------------

  /** Processes for a change, from its worktree's .spindle config (unapproved ones never auto-start). */
  private servicesFor(p: Project, f?: Feature | null): ServiceDef[] {
    return this.runnable(p, f).config.processes
  }

  autoStartServices(featureId: string): void {
    const { f, p } = this.fctx(featureId)
    if (f.kind !== 'feature' || f.cleanedUp) return
    for (const svc of this.servicesFor(p, f).filter((x) => x.autoStart)) this.startServiceDef(f, svc)
  }

  private startServiceDef(f: Feature, svc: ServiceDef) {
    const p = store().project(f.projectId!)
    return this.processes.start(f.id, svc.name, svc.command, 'service', f.worktreePath, { ...this.procEnv(this.runnable(p, f)), SF_URL: f.localUrl ?? '', APP_URL: f.localUrl ?? '' })
  }

  /** Bring a feature's preview server and auto-start services back (e.g. after an app restart). */
  ensureServices(featureId: string): void {
    const { f, p } = this.ctx(featureId)
    if (!p || f.kind !== 'feature' || f.inPlace || f.cleanedUp || f.setupStatus !== 'ok' || !existsSync(f.worktreePath)) return
    const running = new Set(this.processes.list(featureId).filter((x) => x.status === 'running').map((x) => x.name))
    const site = this.siteFor(featureId)
    if (site && !running.has('Web server')) void this.ensureSiteBackend(site).catch(() => {})
    for (const svc of this.servicesFor(p, f).filter((x) => x.autoStart && !running.has(x.name))) this.startServiceDef(f, svc)
  }

  startService(featureId: string, name: string): string {
    const { f, p } = this.fctx(featureId)
    // Starting by hand is allowed for any listed process: the user sees the command they click.
    const svc = this.envOf(p, f).config.processes.find((x) => x.name === name)
    if (!svc) throw new Error(`No service called ${name}`)
    return this.startServiceDef(f, svc).id
  }

  /** Tools the agent may never use: it can't push, merge, deploy or reach servers, whatever the user's role. */
  private agentRestrictions(p: Project | null): string[] {
    const base = ['Bash(git push:*)', 'Bash(gh pr merge:*)', 'Bash(gh api:*)', 'Bash(gh release:*)', 'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(rsync:*)', 'Bash(curl https://ploi.io:*)']
    const limited = store().getSettings().restricted || !p?.access || p.access.role === 'contributor' || p.access.role === 'unknown'
    return limited ? [...base, 'Bash(gh:*)'] : base
  }

  private startAgent(featureId: string, prompt: string, record: boolean, attachments: Attachment[] = []): void {
    const { f, p } = this.ctx(featureId)
    if (f.cleanedUp) throw new Error('This feature was shipped and cleaned up — start a new feature to keep working.')
    if (record) {
      const note = attachments.length ? `\n\n📎 ${attachments.length} screenshot${attachments.length > 1 ? 's' : ''} attached` : ''
      const item: ChatItem = { id: uid('u'), role: 'user', text: prompt + note, ts: Date.now() }
      store().upsertItem(featureId, item)
      this.emit('agent:item', { featureId, item })
    }
    if (f.kind === 'feature' && stageAtLeast(f.stage, 'merged')) {
      this.addSystemItem(featureId, 'Note: this feature was already merged. New changes need a new PR.')
    }
    const next: Feature =
      f.kind === 'feature' ? { ...f, stage: f.stage === 'testing' || f.stage === 'setup' ? 'coding' : f.stage } : f
    this.saveFeature(next)
    const r = p ? this.runnable(p, f) : null
    const mailNote = p && r?.config.mail.capture && this.mail.port ? `Outgoing email from this app is captured locally by Spindle (SMTP 127.0.0.1:${this.mail.port}); it is never delivered to real people.` : ''
    // Codex doesn't expand its custom prompts in exec mode; do it here so /name works the same.
    if (next.agent === 'codex') prompt = expandCodexPrompt(prompt)
    this.agents.start(p, next, store().getSettings(), prompt, [this.processes.describeFor(featureId), mailNote, r ? this.envNote(r) : ''].filter(Boolean).join('\n'), {
      disallowedTools: this.agentRestrictions(p),
      attachments,
      env: r ? this.execEnv(r) : {}
    })
  }

  // ---------------- git / github ----------------

  async suggestCommitMessage(featureId: string): Promise<string> {
    const { f } = this.ctx(featureId)
    const fallback = `feat: ${f.title}`
    const d = await git.diff(f.worktreePath, f.baseBranch)
    if (!d.trim()) return fallback
    const s = store().getSettings()
    const prompt =
      'Write a concise conventional commit message (subject line max 72 chars, optional short body) for this diff. ' +
      'Output ONLY the commit message, no code fences, and do not use any tools.\n\n' +
      truncate(d, 40_000)
    const r = await exec(s.claudePath || 'claude', ['-p', '--output-format', 'text', '--model', 'haiku'], {
      input: prompt,
      cwd: f.worktreePath,
      timeoutMs: 90_000
    })
    const msg = r.stdout.trim().replace(/^```\w*\n?|```$/g, '').trim()
    return r.code === 0 && msg ? msg : fallback
  }

  async createPr(featureId: string, input: { title: string; body: string; draft: boolean }): Promise<PullRequestInfo> {
    const { f, p } = this.fctx(featureId)
    const repo = this.requireRepo(p)
    const access = await this.ensureAccess(p)
    const st = await git.status(f.worktreePath, f.baseBranch)
    if (st.dirty) await git.commitAll(f.worktreePath, await this.suggestCommitMessage(featureId).catch(() => input.title))
    let head = f.branch
    if (access.canPush) {
      await git.push(f.worktreePath, f.branch)
    } else {
      // No write access: work goes to the user's fork, and the PR comes from there.
      if (!access.login) throw new Error('Sign in to GitHub first (Settings → Integrations).')
      await github.ensureFork(repo, f.worktreePath, access.login)
      await git.push(f.worktreePath, f.branch, 'fork')
      head = `${access.login}:${f.branch}`
    }
    const existing = access.canPush ? await github.findPrForBranch(repo, f.branch) : undefined
    const pr = existing
      ? await github.viewPr(repo, existing)
      : await github.createPr(repo, f.worktreePath, { ...input, base: f.baseBranch, head })
    this.saveFeature({ ...store().feature(featureId), prNumber: pr.number, prUrl: pr.url, stage: 'pr' })
    this.addSystemItem(featureId, `Pull request #${pr.number} opened: ${pr.url}`)
    return pr
  }

  async getPr(featureId: string): Promise<PullRequestInfo | null> {
    const { f, p } = this.ctx(featureId)
    if (!p || f.kind === 'chat' || !p.githubRepo || f.inPlace) return null
    const num = f.prNumber ?? (await github.findPrForBranch(p.githubRepo, f.branch))
    if (!num) return null
    const pr = await github.viewPr(p.githubRepo, num)
    let next = { ...store().feature(featureId) }
    let changed = false
    if (next.prNumber !== pr.number) {
      next = { ...next, prNumber: pr.number, prUrl: pr.url }
      changed = true
    }
    if (pr.state === 'MERGED' && !stageAtLeast(next.stage, 'merged')) {
      next.stage = 'merged'
      changed = true
    } else if (pr.state === 'OPEN' && !stageAtLeast(next.stage, 'pr')) {
      next.stage = 'pr'
      changed = true
    }
    if (changed) this.saveFeature(next)
    return pr
  }

  async mergePr(featureId: string): Promise<string> {
    const { f, p } = this.fctx(featureId)
    const repo = this.requireRepo(p)
    const s = store().getSettings()
    const access = await this.ensureAccess(p, true)
    if (!access.canMerge) {
      throw new Error(
        s.restricted
          ? 'This machine is set up for contributing only — approving and applying changes is turned off.'
          : `Your GitHub account (${access.login ?? 'unknown'}) can't merge in ${repo}. A maintainer will review and apply it.`
      )
    }
    const num = f.prNumber ?? (await github.findPrForBranch(repo, f.branch))
    if (!num) throw new Error('No pull request found for this feature')
    // Enforced here, not just in the UI: never merge while CI runs or after it failed.
    const [prNow, runs] = await Promise.all([github.viewPr(repo, num), github.listRuns(repo, f.branch).catch(() => [])])
    const gate = ciGate(prNow.checks, runs)
    if (!gate.ok) throw new Error(gate.reason)
    const out = await github.mergePr(repo, num, s.mergeMethod)
    if (s.deleteBranchOnMerge) await github.deleteRemoteBranch(f.worktreePath, f.branch)
    this.saveFeature({ ...store().feature(featureId), stage: 'merged' })
    this.addSystemItem(featureId, `Merged PR #${num} into ${f.baseBranch}.`)
    notify(`🔀 Merged: ${f.title}`, `PR #${num} merged into ${f.baseBranch}`)
    // Keep the main checkout's base branch current if it's checked out and clean.
    void exec('git', ['pull', '--ff-only'], { cwd: p.path, timeoutMs: 60_000 })
    for (const env of p.environments) {
      if (env.branch !== f.baseBranch || !env.ploiServerId || !env.ploiSiteId) continue
      if (env.autoDeployOnMerge && access.canDeploy) {
        this.deploy(p.id, env.id, featureId).catch((e) => this.toast('error', `Auto-deploy failed: ${e.message}`))
      } else {
        // Ploi may deploy on push by itself — watch so it shows up live here too.
        void this.deploys.watchForExternal(p, env, featureId)
      }
    }
    this.maybeCleanupAfterShip(featureId, 'merged')
    return out || `Merged #${num}`
  }

  // ---------------- deploy ----------------

  async deploy(projectId: string, envId: string, featureId?: string): Promise<DeployResult> {
    const p = store().project(projectId)
    const env = p.environments.find((e) => e.id === envId)
    if (!env) throw new Error('Unknown environment')
    const access = await this.ensureAccess(p, true)
    if (!access.canDeploy) {
      throw new Error(
        store().getSettings().restricted
          ? 'Deploying is turned off on this machine.'
          : `Only maintainers of ${p.githubRepo ?? p.name} can deploy. Your role: ${access.role}.`
      )
    }
    const st = await this.deploys.trigger(p, env, featureId)
    if (featureId) {
      this.addSystemItem(featureId, `Deploying to ${env.name}…`)
      this.saveFeature({ ...store().feature(featureId), lastDeploy: { envId, at: Date.now(), status: 'deploying' } })
    }
    return { ok: true, message: st.message ?? 'Deployment started' }
  }

  private onDeployFinished(d: DeployState): void {
    let p: Project
    try {
      p = store().project(d.projectId)
    } catch {
      return
    }
    const env = p.environments.find((e) => e.id === d.envId)
    const success = d.status === 'success'
    const secs = d.startedAt && d.finishedAt ? Math.round((d.finishedAt - d.startedAt) / 1000) : undefined
    const took = secs ? ` in ${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}` : ''
    if (Notification.isSupported()) {
      new Notification({ title: success ? `✅ Deployed ${p.name}` : `❌ Deploy failed: ${p.name}`, body: `${env?.name ?? ''}${took}${d.message ? ` — ${truncate(d.message, 100)}` : ''}` }).show()
    }
    this.toast(success ? 'success' : 'error', `${p.name} → ${env?.name}: ${success ? `deployed${took}` : d.error ?? 'deploy failed'}`)
    if (!d.featureId) return
    try {
      const f = store().feature(d.featureId)
      this.saveFeature({
        ...f,
        stage: success && f.stage === 'merged' ? 'deployed' : f.stage,
        lastDeploy: { envId: d.envId, at: Date.now(), status: d.status }
      })
      this.addSystemItem(d.featureId, success ? `Deployed to ${env?.name}${took}.` : `Deploy to ${env?.name} failed${d.error ? `: ${d.error}` : ''}.`, success ? 'system' : 'error')
      if (success && stageAtLeast(f.stage, 'merged')) this.maybeCleanupAfterShip(d.featureId, 'deployed')
    } catch {
      /* feature archived meanwhile */
    }
  }

  deployStates(): DeployState[] {
    return this.deploys.all()
  }

  async deployHistory(projectId: string, envId: string): Promise<DeploymentInfo[]> {
    const env = store().project(projectId).environments.find((e) => e.id === envId)
    if (!env?.ploiServerId || !env.ploiSiteId) return []
    return this.ploi().deployments(env.ploiServerId, env.ploiSiteId, 8)
  }

  async deploymentLog(projectId: string, envId: string, deploymentId: string): Promise<string> {
    const env = store().project(projectId).environments.find((e) => e.id === envId)
    if (!env?.ploiServerId || !env.ploiSiteId) return ''
    return this.ploi().deploymentLog(env.ploiServerId, env.ploiSiteId, deploymentId)
  }

  /** Keep "last deployed" fresh and pick up deploys started outside the app. */
  startDeployRefresh(): void {
    const tick = () => {
      if (!store().getSecret('ploi')) return
      for (const p of store().projects()) for (const env of p.environments) void this.deploys.refresh(p, env).catch(() => {})
    }
    setTimeout(tick, 3000)
    this.deployRefreshTimer = setInterval(tick, 5 * 60_000)
  }

  async deploymentStatus(projectId: string, envId: string): Promise<DeploymentInfo> {
    const d = this.deploys.get(projectId, envId)
    if (!d) return { status: 'unknown', message: 'No deployments yet' }
    return { id: d.deploymentId, status: d.status, message: d.message ?? '', commit: d.commit, log: d.log }
  }

  // ---------------- logs ----------------

  async readRemoteLog(projectId: string, envId: string, lines: number): Promise<string> {
    const env = store().project(projectId).environments.find((e) => e.id === envId)
    if (!env?.sshTarget || !env.remotePath) throw new Error('Set an SSH target and remote path for this environment in project settings.')
    return logs.tailRemote(env.sshTarget, env.remotePath, lines)
  }

  mcpStatus() {
    return mcp.status(store().getSettings())
  }

  installMcp(name: 'nightwatch' | 'ploi', agent: AgentKind) {
    return mcp.install(store().getSettings(), name, agent)
  }

  // ---------------- processes ----------------

  runCommand(featureId: string, command: string): string {
    const { f, p } = this.ctx(featureId)
    const name = command.length > 40 ? command.slice(0, 39) + '…' : command
    return this.processes.start(featureId, name, command, 'command', f.worktreePath, { ...(p ? this.procEnv(this.runnable(p, f)) : {}), SF_URL: f.localUrl ?? '' }).id
  }

  // ---------------- os ----------------

  async openInEditor(path: string): Promise<void> {
    const cmd = store().getSettings().editorCommand || 'open'
    const r = await shell(`${cmd} ${shellQuote(path)}`)
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Editor command failed: ${cmd}`)
  }

  async openInTerminal(path: string): Promise<void> {
    await run('open', ['-a', 'Terminal', path])
  }

  async openInFinder(path: string): Promise<void> {
    await eShell.openPath(path)
  }

  shutdown(): void {
    this.agents.stopAll()
    this.processes.killAll()
    this.mail.stop()
    this.web.stop()
    this.deploys.stopAll()
    if (this.deployRefreshTimer) clearInterval(this.deployRefreshTimer)
    store().flush()
  }
}

/** Directory a site serves: the configured docroot, else public/ for Laravel-style apps, else the root. */
function docrootOf(dir: string, env?: DevEnvironment): string {
  const configured = env?.site.docroot?.replace(/^\.?\/+|\/+$/g, '')
  if (configured && !configured.split('/').includes('..')) return join(dir, configured)
  return existsSync(join(dir, 'public')) ? join(dir, 'public') : dir
}

/** Can the built-in server serve this directory (a site command, a PHP app or a static site)? */
function servable(dir: string, env?: DevEnvironment): boolean {
  if (env?.site.command) return true
  const d = docrootOf(dir, env)
  return existsSync(join(dir, 'artisan')) || existsSync(join(d, 'index.php')) || existsSync(join(d, 'index.html'))
}
