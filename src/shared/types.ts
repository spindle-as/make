// Shared domain model + IPC contract between main, preload and renderer.

export type AgentKind = 'claude' | 'codex'

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan'

export interface Environment {
  id: string
  name: string // e.g. "production", "staging"
  branch: string // branch that this environment deploys
  ploiServerId?: string
  ploiSiteId?: string
  url?: string
  /** ssh target for reading remote logs, e.g. ploi@1.2.3.4 */
  sshTarget?: string
  /** absolute path of the site on the server, e.g. /home/ploi/example.com */
  remotePath?: string
  /** Nightwatch dashboard URL for this environment */
  nightwatchUrl?: string
  /** trigger a deploy automatically after a PR is merged into `branch` */
  autoDeployOnMerge?: boolean
}

export type DbDriver = 'mysql' | 'mariadb' | 'pgsql' | 'sqlite'

/** How each feature gets its database: share the main one, an empty one (migrated), or a clone. */
export type DbMode = 'shared' | 'empty' | 'clone'

export interface ProjectDatabase {
  mode: DbMode
  /** run `php artisan migrate` (and seeders for empty databases) after provisioning */
  migrate: boolean
}

export interface FeatureDatabase {
  driver: DbDriver
  /** database name, or the sqlite file path */
  name: string
  host?: string
  port?: number
  user?: string
  source?: string
  /** true only for databases Software Factory created — the only ones it will ever drop */
  created: boolean
}

export interface DbService {
  id: string
  name: string
  kind: 'mysql' | 'mariadb' | 'pgsql' | 'redis'
  version: string
  port: number
  binaries: string
  running: boolean
}

/** What the current GitHub user may do in a repo — enforced in the main process, not just hidden in the UI. */
export type AccessRole = 'maintainer' | 'developer' | 'contributor' | 'unknown'

export interface RepoAccess {
  role: AccessRole
  login?: string
  canPush: boolean
  canMerge: boolean
  canDeploy: boolean
  checkedAt: number
  detail?: string
}

/** Automatic first-time setup of a project's main checkout (resumable). */
export interface ProjectSetupState {
  status: 'running' | 'done' | 'failed'
  steps: { id: string; label: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; detail?: string }[]
  log: string
  error?: string
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  slug: string
  path: string // main checkout
  defaultBranch: string
  githubRepo?: string // owner/name
  isLaravel: boolean
  herdEnabled: boolean
  herdSecure: boolean
  /** shell script run inside every new worktree */
  setupScript: string
  /** commands shown as quick actions in the terminal panel */
  quickCommands: string[]
  /** long-running processes per feature (dev server, queue worker, …) */
  services?: ServiceDef[]
  defaultAgent: AgentKind
  database?: ProjectDatabase
  /** capture outgoing mail in Spindle instead of sending it (default on) */
  captureMail?: boolean
  access?: RepoAccess
  setup?: ProjectSetupState
  /** URL of the main checkout's local site */
  localUrl?: string
  /** who serves local sites: Spindle's built-in HTTPS server or Laravel Herd */
  server?: 'spindle' | 'herd'
  /** internal PHP backend port for the main checkout (built-in server) */
  sitePort?: number
  /** fingerprints of .spindle command sets the user approved on this machine (repo files can't run commands unapproved) */
  trustedEnvHashes?: string[]
  environments: Environment[]
  createdAt: number
}

/** A thread is either a feature (own branch/worktree, full ship pipeline) or a plain chat. */
export type ThreadKind = 'feature' | 'chat'

export type FeatureStage = 'setup' | 'coding' | 'testing' | 'pr' | 'merged' | 'deployed' | 'archived'

export interface Feature {
  id: string
  kind: ThreadKind
  /** null for general chats that are not tied to a project */
  projectId: string | null
  title: string
  /** set once the user renames the thread, so auto-titling never overrides it */
  titleLocked?: boolean
  slug: string
  branch: string
  baseBranch: string
  worktreePath: string
  /** true when the feature works directly in the main checkout (no worktree) */
  inPlace: boolean
  agent: AgentKind
  model?: string
  /** reasoning effort; values depend on agent/model (low…max, ultra) */
  effort?: string
  /** Claude only: hard cap on spend per turn */
  maxBudgetUsd?: number
  permissionMode: PermissionMode
  sessionId?: string // agent-native session/thread id for resume
  stage: FeatureStage
  herdSite?: string
  /** content hash of the worktree's .spindle/config.json when it was created; until the branch edits it, the change follows the main checkout's live file */
  envBaseHash?: string
  localUrl?: string
  prNumber?: number
  prUrl?: string
  setupLog?: string
  setupStatus?: 'running' | 'ok' | 'failed'
  lastDeploy?: { envId: string; at: number; status: string }
  database?: FeatureDatabase
  /** internal PHP backend port (built-in server) */
  sitePort?: number
  /** worktree, Herd site and database were removed after shipping; history is kept */
  cleanedUp?: boolean
  /** results of "Check changes" runs — the only source for "tests passed" claims */
  checks?: CheckResult[]
  /** visual change requests made from the preview */
  visualNotes?: string[]
  costUsd?: number
  createdAt: number
  updatedAt: number
}

export interface CheckResult {
  name: string
  command: string
  ok: boolean
  code: number | null
  at: number
  durationMs: number
  /** last lines of output */
  summary: string
}

/** Live state of a "Check changes" run. */
export interface ChecksProgress {
  featureId: string
  running: boolean
  results: CheckResult[]
  /** every check in this run, in order */
  plan?: { name: string; command: string }[]
  /** the check running right now (its process streams output) */
  current?: { name: string; command: string; processId: string; startedAt: number }
  startedAt?: number
  cancelled?: boolean
}

export interface Attachment {
  mediaType: 'image/png' | 'image/jpeg'
  /** base64 without the data: prefix */
  data: string
  name?: string
}

// ---------- Mail capture ----------

export interface MailSummary {
  id: string
  featureId: string
  from: string
  to: string[]
  subject: string
  date: number
  hasHtml: boolean
  attachments: { filename: string; contentType: string; size: number }[]
  read: boolean
}

export interface MailMessage extends MailSummary {
  text?: string
  html?: string
  headers: [string, string][]
  raw: string
}

// ---------- Database browser ----------

export interface DbTable {
  name: string
  rows?: number
}

export interface QueryResult {
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
  ms: number
  affected?: string
}

export interface DbSnapshot {
  id: string
  featureId: string
  label: string
  at: number
  size: number
}

export interface WebServerStatus {
  running: boolean
  httpsPort: number
  httpPort: number
  trusted: boolean
  sites: { host: string; url: string; owner: string }[]
  /** what holds 443 when we couldn't get it */
  portNote?: string
  error?: string
}

export interface GithubRepoRef {
  nameWithOwner: string
  description?: string
  isPrivate: boolean
  updatedAt: string
  permission: AccessRole
}

// ---------- Agent chat ----------

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'thinking'

export interface ChatItem {
  id: string
  role: ChatRole
  text: string
  ts: number
  /** live state for system cards (e.g. worktree setup) and streaming text */
  status?: 'running' | 'ok' | 'error'
  tool?: {
    name: string
    summary: string
    input?: string
    output?: string
    status: 'running' | 'ok' | 'error'
  }
}

// ---------- Models ----------

export interface EffortOption {
  id: string
  label: string
  description?: string
}

export interface ModelOption {
  /** value passed to --model / -m; '' means the CLI default */
  id: string
  label: string
  description?: string
  efforts: EffortOption[]
  defaultEffort?: string
}

export interface ModelCatalog {
  claude: ModelOption[]
  codex: ModelOption[]
  /** what each CLI uses when no model/effort is passed */
  defaults: { claude: { model?: string; effort?: string }; codex: { model?: string; effort?: string } }
}

// ---------- Integrations ----------

export type IntegrationId = 'claude' | 'codex' | 'github' | 'webserver' | 'herd' | 'dbngin' | 'ploi' | 'nightwatch'
export type IntegrationAction = 'install' | 'repair' | 'login' | 'connect' | 'setup'

export interface IntegrationStatus {
  id: IntegrationId
  name: string
  description: string
  installed: boolean
  /** null when sign-in doesn't apply */
  signedIn: boolean | null
  ready: boolean
  optional: boolean
  version?: string
  account?: string
  detail?: string
  actions: IntegrationAction[]
}

export interface PloiSiteRef {
  serverId: string
  serverName: string
  serverIp?: string
  siteId: string
  domain: string
  systemUser?: string
  /** match score against a project (higher = better) */
  score?: number
}

/** A tool call waiting for the user's approval, or a question the agent asked (AskUserQuestion). */
export interface AgentQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description?: string }[]
}

export interface PendingRequest {
  id: string
  featureId: string
  kind: 'permission' | 'question'
  toolName: string
  /** short human label, e.g. "Run a command" */
  title: string
  /** the command, file path or description being approved */
  detail: string
  input: Record<string, unknown>
  questions?: AgentQuestion[]
  /** rule suggestions from the CLI, used for "always allow" */
  suggestions?: unknown[]
  createdAt: number
}

export type PermissionDecision = 'allow' | 'allow-always' | 'deny'

// ---------- Background processes ----------

export type ProcessStatus = 'running' | 'exited' | 'crashed' | 'stopped'

export interface ProcessInfo {
  id: string
  featureId: string
  name: string
  command: string
  kind: 'service' | 'command'
  status: ProcessStatus
  code?: number | null
  startedAt: number
  endedAt?: number
  logFile: string
}

export interface ServiceDef {
  name: string
  command: string
  /** start automatically when a feature's workspace is ready */
  autoStart: boolean
}

// ---------- Development environment (.spindle/config.json) ----------

/**
 * How a project runs locally. Lives in the repo at .spindle/config.json so it is
 * versioned and shared with the team; each change's worktree reads its own copy.
 */
export interface DevEnvironment {
  version: 1
  /** pinned tool versions; empty = whatever is on your PATH */
  runtime: { php?: string; node?: string }
  /** how the local website is served */
  site: {
    /** folder served, relative to the project (default: public/ when it exists) */
    docroot?: string
    /** custom backend instead of PHP's server, e.g. "npm run preview -- --port $PORT" */
    command?: string
  }
  /** shell commands run in order in every new change's workspace */
  setup: string[]
  /** long-running processes per change (dev server, queue worker…) */
  processes: ServiceDef[]
  /** quick commands shown in the terminal panel */
  commands: string[]
  database: ProjectDatabase
  mail: { capture: boolean }
  /** values written into each change's .env (and given to its processes) */
  env: Record<string, string>
}

export interface RuntimeMatch {
  version: string
  /** directory put first on PATH */
  dir: string
  source: string
}

export interface DevEnvView {
  config: DevEnvironment
  /** 'file' when .spindle/config.json exists, otherwise detected from the project */
  source: 'file' | 'detected'
  file: string
  /** contents of .spindle/instructions.md — how the project works, given to the AI */
  instructions: string
  /** false when the file's commands changed since you last approved them */
  trusted: boolean
  /** fingerprint of the commands as read now */
  hash: string
  /** commands awaiting approval (when not trusted) */
  commands: string[]
  parseError?: string
  runtime: { php?: RuntimeMatch | null; node?: RuntimeMatch | null }
  installed: { php: RuntimeMatch[]; node: RuntimeMatch[] }
  /** hints detected from the project (composer.json php constraint, .nvmrc) */
  hints: { php?: string; node?: string; phpMin?: string }
  /** problems with the pinned versions (not installed, too old for the installed packages) */
  warnings: string[]
}

// ---------- Deploy tracking ----------

export interface DeployState {
  projectId: string
  envId: string
  status: 'idle' | 'queued' | 'deploying' | 'success' | 'failed'
  /** who started it: this app, or Ploi itself (e.g. auto-deploy on push) */
  source?: 'app' | 'ploi'
  deploymentId?: string
  featureId?: string
  startedAt?: number
  finishedAt?: number
  commit?: string
  message?: string
  log?: string
  error?: string
}

export interface AgentStatus {
  featureId: string
  running: boolean
  /** number of approvals/questions waiting for the user */
  waiting?: number
  sessionId?: string
  costUsd?: number
  error?: string
}

// ---------- Git ----------

export interface GitFileChange {
  path: string
  status: string // M, A, D, R, ?? ...
  additions: number
  deletions: number
}

export interface GitStatusInfo {
  branch: string
  ahead: number
  behind: number
  dirty: boolean
  files: GitFileChange[]
  commitsAhead: { sha: string; subject: string }[]
}

// ---------- GitHub ----------

export interface CheckRun {
  name: string
  state: string // SUCCESS, FAILURE, PENDING, ...
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
  link?: string
  workflow?: string
}

export interface PullRequestInfo {
  number: number
  url: string
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  mergeable: string
  mergeStateStatus?: string
  reviewDecision?: string
  checks: CheckRun[]
  headRefName: string
  baseRefName: string
}

export interface WorkflowRun {
  databaseId: number
  name: string
  displayTitle: string
  status: string
  conclusion: string
  headBranch: string
  event: string
  url: string
  createdAt: string
}

// ---------- Ploi ----------

export interface PloiServer {
  id: number
  name: string
  ip_address?: string
  status?: string
}

export interface PloiSite {
  id: number
  domain: string
  project_type?: string
  status?: string
  deploy_script?: boolean
  test_domain?: string
  system_user?: string
  project_root?: string
}

export interface DeployResult {
  ok: boolean
  message: string
}

export interface DeploymentInfo {
  id?: string
  status: string // deploying | success | failed | scheduled | cancelled | unknown
  message: string
  commit?: string
  log?: string
  at?: string
}

export interface McpStatus {
  name: 'nightwatch' | 'ploi'
  agent: AgentKind
  installed: boolean
  detail?: string
}

// ---------- Herd ----------

export interface HerdSite {
  site: string
  url: string
  path: string
  secured: boolean
  php?: string
}

// ---------- Settings ----------

export interface Settings {
  worktreeRoot: string
  claudePath: string
  codexPath: string
  defaultPermissionMode: PermissionMode
  claudeModel: string
  codexModel: string
  claudeEffort: string
  codexEffort: string
  editorCommand: string // e.g. "phpstorm" or "open -a 'PhpStorm'"
  branchPrefix: string
  hasPloiToken: boolean
  mergeMethod: 'squash' | 'merge' | 'rebase'
  deleteBranchOnMerge: boolean
  removeWorktreeOnMerge: boolean
  /** remove worktree, Herd site, database and local branch once a feature is merged (and deployed) */
  cleanupAfterShip: boolean
  /** Creator mode hides technical detail; Developer mode shows everything */
  mode: 'creator' | 'developer'
  /** this machine never deploys or merges, whatever the GitHub role (e.g. a shared/contributor machine) */
  restricted: boolean
  /** where "Open project" clones repositories */
  projectsRoot: string
  /** UI zoom factor (1 = 100%) */
  uiScale: number
  /** first-run onboarding completed/dismissed */
  onboarded: boolean
  /** download new versions in the background; installing always waits for you */
  autoUpdate: boolean
}

// ---------- App updates ----------

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  latest?: string
  /** release notes (markdown) */
  notes?: string
  url?: string
  publishedAt?: string
  size?: number
  /** 0–1 while downloading */
  progress?: number
  error?: string
  checkedAt?: number
  /** false in development builds: updates install only into the packaged app */
  canInstall: boolean
}

export interface ToolHealth {
  name: string
  ok: boolean
  version?: string
  detail?: string
}

// ---------- Terminal ----------

export interface TerminalChunk {
  runId: string
  featureId: string
  stream: 'stdout' | 'stderr' | 'system'
  data: string
}

export interface LogSource {
  kind: 'local' | 'remote'
  label: string
  envId?: string
}

// ---------- IPC contract ----------

export interface NewProjectInput {
  path: string
}

export interface NewFeatureInput {
  kind?: ThreadKind
  projectId: string | null
  title?: string
  prompt?: string
  agent?: AgentKind
  model?: string
  effort?: string
  permissionMode?: PermissionMode
  inPlace?: boolean
  baseBranch?: string
  /** screenshots sent with the first message (e.g. elements picked on the main version) */
  attachments?: Attachment[]
}

/** The project's main version: running, current, and the starting point for new changes. */
export interface MainSiteState {
  url?: string
  branch: string
  defaultBranch: string
  /** the main checkout has uncommitted changes (so it isn't updated automatically) */
  dirty: boolean
  /** commits pulled just now */
  updated: number
  /** dependencies/assets/migrations are being refreshed after an update */
  refreshing: boolean
  /** why it wasn't updated, or what's off */
  note?: string
}

export interface Api {
  // app
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  setSecret(key: 'ploi', value: string): Promise<void>
  checkTools(): Promise<ToolHealth[]>
  updateState(): Promise<UpdateState>
  /** Dock badge: threads waiting on you */
  setBadge(count: number): Promise<void>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  /** quits, swaps the app bundle and relaunches */
  installUpdate(): Promise<void>
  integrations(): Promise<IntegrationStatus[]>
  integrationAction(id: IntegrationId, action: IntegrationAction): Promise<string>
  connectPloi(token: string): Promise<{ servers: number; sites: number }>
  listModels(): Promise<ModelCatalog>
  setZoom(scale: number): Promise<number>
  pickDirectory(): Promise<string | null>
  openExternal(url: string): Promise<void>
  openInEditor(path: string): Promise<void>
  openInFinder(path: string): Promise<void>
  openInTerminal(path: string): Promise<void>

  // onboarding & access
  githubRepos(query?: string): Promise<GithubRepoRef[]>
  openGithubRepo(nameWithOwner: string): Promise<Project>
  createLaravelProject(name: string): Promise<Project>
  prepareProject(projectId: string): Promise<void>
  refreshAccess(projectId: string): Promise<RepoAccess>

  // mail
  mailList(featureId: string): Promise<MailSummary[]>
  mailGet(id: string): Promise<MailMessage | null>
  mailClear(featureId: string): Promise<void>
  mailServerInfo(): Promise<{ port: number }>

  // database browser
  dbTables(featureId: string): Promise<{ driver: DbDriver; database: string; tables: DbTable[]; editable: boolean }>
  dbRows(featureId: string, table: string, page: number): Promise<QueryResult>
  dbQuery(featureId: string, sql: string, allowWrite: boolean): Promise<QueryResult>
  dbSnapshots(featureId: string): Promise<DbSnapshot[]>
  dbSnapshot(featureId: string, label: string): Promise<DbSnapshot>
  dbRestore(featureId: string, snapshotId: string): Promise<void>
  dbReset(featureId: string): Promise<string>

  // review
  cancelChecks(featureId: string): Promise<void>
  checkChanges(featureId: string): Promise<CheckResult[]>
  draftPr(featureId: string): Promise<{ title: string; body: string }>
  addVisualNote(featureId: string, note: string): Promise<void>

  // projects
  listProjects(): Promise<Project[]>
  addProject(input: NewProjectInput): Promise<Project>
  updateProject(id: string, patch: Partial<Project>): Promise<Project>
  removeProject(id: string): Promise<void>

  // features
  listFeatures(): Promise<Feature[]>
  createFeature(input: NewFeatureInput): Promise<Feature>
  updateFeature(id: string, patch: Partial<Feature>): Promise<Feature>
  rerunSetup(id: string): Promise<void>
  archiveFeature(id: string, opts: { removeWorktree: boolean; deleteBranch: boolean }): Promise<void>
  promoteToFeature(chatId: string): Promise<Feature>
  cleanupFeature(id: string): Promise<void>
  dbServices(): Promise<DbService[]>
  projectDbInfo(projectId: string): Promise<{ driver: DbDriver; database: string; port?: number } | null>

  // agent
  getThread(featureId: string): Promise<ChatItem[]>
  sendPrompt(featureId: string, prompt: string, attachments?: Attachment[]): Promise<void>
  stopAgent(featureId: string): Promise<void>
  pendingRequests(): Promise<PendingRequest[]>
  respondPermission(featureId: string, requestId: string, decision: PermissionDecision, message?: string): Promise<void>
  answerQuestion(featureId: string, requestId: string, answers: Record<string, string>): Promise<void>
  clearThread(featureId: string): Promise<void>
  agentStatuses(): Promise<AgentStatus[]>

  // git
  gitStatus(featureId: string): Promise<GitStatusInfo>
  gitDiff(featureId: string, file?: string): Promise<string>
  commit(featureId: string, message: string): Promise<string>
  suggestCommitMessage(featureId: string): Promise<string>
  push(featureId: string): Promise<string>
  syncWithBase(featureId: string): Promise<string>
  discardFile(featureId: string, file: string): Promise<void>

  // github
  createPr(featureId: string, input: { title: string; body: string; draft: boolean }): Promise<PullRequestInfo>
  getPr(featureId: string): Promise<PullRequestInfo | null>
  mergePr(featureId: string): Promise<string>
  listRuns(featureId: string): Promise<WorkflowRun[]>
  failedRunLog(runId: number, projectId: string): Promise<string>
  rerunFailed(runId: number, projectId: string): Promise<string>

  // herd
  herdSites(): Promise<HerdSite[]>
  herdLink(featureId: string): Promise<string>
  herdUnlink(featureId: string): Promise<void>

  // ploi
  ploiServers(): Promise<PloiServer[]>
  ploiSites(serverId: string): Promise<PloiSite[]>
  ploiAllSites(): Promise<PloiSiteRef[]>
  suggestPloiSites(projectId: string): Promise<PloiSiteRef[]>
  linkPloiSite(projectId: string, ref: PloiSiteRef): Promise<Project>
  deploy(projectId: string, envId: string, featureId?: string): Promise<DeployResult>
  deploymentStatus(projectId: string, envId: string): Promise<DeploymentInfo>
  deployStates(): Promise<DeployState[]>
  deployHistory(projectId: string, envId: string): Promise<DeploymentInfo[]>
  deploymentLog(projectId: string, envId: string, deploymentId: string): Promise<string>

  // logs
  readLocalLog(featureId: string, lines: number): Promise<string>
  readRemoteLog(projectId: string, envId: string, lines: number): Promise<string>
  clearLocalLog(featureId: string): Promise<void>
  mcpStatus(): Promise<McpStatus[]>
  installMcp(name: 'nightwatch' | 'ploi', agent: AgentKind): Promise<string>

  // processes (services + one-off commands)
  listProcesses(featureId?: string): Promise<ProcessInfo[]>
  processOutput(processId: string): Promise<string>
  runCommand(featureId: string, command: string): Promise<string>
  startService(featureId: string, name: string): Promise<string>
  ensureServices(featureId: string): Promise<void>
  webServerStatus(): Promise<WebServerStatus>
  /** a project's environment, or (with featureId) the one a change's worktree uses */
  /** start (if needed) and update the project's main version; returns where it runs */
  mainSite(projectId: string): Promise<MainSiteState>
  devEnv(projectId: string, featureId?: string): Promise<DevEnvView>
  /** baseHash: the version the editor started from — refused if the file changed since */
  saveDevEnv(projectId: string, config: DevEnvironment, instructions?: string, baseHash?: string): Promise<DevEnvView>
  detectDevEnv(projectId: string): Promise<DevEnvironment>
  trustDevEnv(projectId: string, featureId?: string): Promise<DevEnvView>
  trustCertificates(): Promise<void>
  stopProcess(processId: string): Promise<void>
  restartProcess(processId: string): Promise<string>
  removeProcess(processId: string): Promise<void>
  writeProcessInput(processId: string, text: string): Promise<void>

  // events
  on<K extends keyof Events>(channel: K, cb: (payload: Events[K]) => void): () => void
}

export interface Events {
  'agent:item': { featureId: string; item: ChatItem }
  'agent:status': AgentStatus
  'feature:changed': Feature
  'feature:removed': { id: string }
  'project:changed': Project
  'agent:request': PendingRequest
  'agent:request-resolved': { featureId: string; id: string }
  'process:changed': ProcessInfo
  'process:removed': { id: string; featureId: string }
  'process:output': { id: string; featureId: string; stream: 'stdout' | 'stderr'; data: string }
  'deploy:changed': DeployState
  'toast': { kind: 'info' | 'success' | 'error'; message: string }
  'settings:changed': Settings
  'mail:received': MailSummary
  'checks:changed': ChecksProgress
  'update:changed': UpdateState
  'main:updated': { projectId: string; commits: number }
}
