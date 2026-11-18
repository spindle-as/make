import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatItem, DeployState, Feature, Project, Settings } from '@shared/types'

interface StateFile {
  projects: Project[]
  features: Feature[]
  settings: Omit<Settings, 'hasPloiToken'>
  secrets: Record<string, string> // base64 of safeStorage-encrypted values
  deploys: Record<string, DeployState>
}

const defaults: StateFile['settings'] = {
  worktreeRoot: join(homedir(), 'SoftwareFactory', 'worktrees'),
  claudePath: 'claude',
  codexPath: 'codex',
  defaultPermissionMode: 'acceptEdits',
  claudeModel: '',
  codexModel: '',
  editorCommand: 'phpstorm',
  branchPrefix: 'feature/',
  claudeEffort: '',
  codexEffort: '',
  mergeMethod: 'squash',
  deleteBranchOnMerge: true,
  removeWorktreeOnMerge: false,
  cleanupAfterShip: true,
  mode: 'creator',
  restricted: false,
  projectsRoot: join(homedir(), 'Spindle', 'projects'),
  uiScale: 1,
  onboarded: false,
  autoUpdate: true
}

function dir(): string {
  const d = app.getPath('userData')
  mkdirSync(join(d, 'threads'), { recursive: true })
  return d
}

function atomicWrite(file: string, data: string): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

class Store {
  private state: StateFile
  private file: string
  private saveTimer: NodeJS.Timeout | null = null
  private threadCache = new Map<string, ChatItem[]>()
  private threadTimers = new Map<string, NodeJS.Timeout>()

  constructor() {
    this.file = join(dir(), 'state.json')
    let loaded: Partial<StateFile> = {}
    if (existsSync(this.file)) {
      try {
        loaded = JSON.parse(readFileSync(this.file, 'utf8'))
      } catch {
        loaded = {}
      }
    }
    this.state = {
      projects: loaded.projects ?? [],
      features: loaded.features ?? [],
      settings: { ...defaults, ...(loaded.settings ?? {}) },
      secrets: loaded.secrets ?? {},
      deploys: loaded.deploys ?? {}
    }
    // A deploy that was "running" when the app quit gets re-checked on start.
    // An app restart kills any agent processes; don't leave stale "running" setup.
    for (const f of this.state.features) {
      if (f.setupStatus === 'running') f.setupStatus = 'failed'
      if (!f.kind) f.kind = 'feature' // threads created before chats existed
    }
    // Old default setup scripts exited 1 when a file was missing; upgrade untouched copies.
    for (const p of this.state.projects) {
      p.setupScript = p.setupScript
        .replace('[ -f composer.json ] && composer install --no-interaction --prefer-dist --no-progress', 'if [ -f composer.json ]; then composer install --no-interaction --prefer-dist --no-progress; fi')
        .replace('[ -f package.json ] && npm install --no-audit --no-fund', 'if [ -f package.json ]; then npm install --no-audit --no-fund; fi')
    }
    if (loaded.settings && loaded.settings.onboarded === undefined && this.state.projects.length) this.state.settings.onboarded = true
    // People who already used the app before modes existed are developers.
    if (loaded.settings && loaded.settings.mode === undefined && this.state.projects.length) this.state.settings.mode = 'developer'
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 150)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    atomicWrite(this.file, JSON.stringify(this.state, null, 2))
    for (const id of this.threadTimers.keys()) this.flushThread(id)
  }

  // ---- settings ----
  getSettings(): Settings {
    return {
      ...this.state.settings,
      hasPloiToken: !!this.state.secrets.ploi
    }
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const { hasPloiToken: _a, ...rest } = patch
    this.state.settings = { ...this.state.settings, ...rest }
    this.persist()
    return this.getSettings()
  }

  setSecret(key: string, value: string): void {
    if (!value) {
      delete this.state.secrets[key]
    } else if (safeStorage.isEncryptionAvailable()) {
      this.state.secrets[key] = 'enc:' + safeStorage.encryptString(value).toString('base64')
    } else {
      this.state.secrets[key] = 'raw:' + Buffer.from(value).toString('base64')
    }
    this.persist()
  }

  getSecret(key: string): string | undefined {
    const v = this.state.secrets[key]
    if (!v) return undefined
    const buf = Buffer.from(v.slice(4), 'base64')
    if (v.startsWith('enc:')) return safeStorage.decryptString(buf)
    return buf.toString()
  }

  // ---- deploys ----
  deploys(): DeployState[] {
    return Object.values(this.state.deploys)
  }

  setDeploy(d: DeployState): void {
    this.state.deploys[`${d.projectId}:${d.envId}`] = { ...d, log: d.log?.slice(-20_000) }
    this.persist()
  }

  // ---- projects ----
  projects(): Project[] {
    return this.state.projects
  }

  project(id: string): Project {
    const p = this.state.projects.find((x) => x.id === id)
    if (!p) throw new Error(`Unknown project ${id}`)
    return p
  }

  upsertProject(p: Project): Project {
    const i = this.state.projects.findIndex((x) => x.id === p.id)
    if (i >= 0) this.state.projects[i] = p
    else this.state.projects.push(p)
    this.persist()
    return p
  }

  removeProject(id: string): void {
    this.state.projects = this.state.projects.filter((p) => p.id !== id)
    for (const f of this.state.features.filter((f) => f.projectId === id)) this.removeFeature(f.id)
    this.persist()
  }

  // ---- features ----
  features(): Feature[] {
    return this.state.features
  }

  feature(id: string): Feature {
    const f = this.state.features.find((x) => x.id === id)
    if (!f) throw new Error(`Unknown feature ${id}`)
    return f
  }

  upsertFeature(f: Feature): Feature {
    f.updatedAt = Date.now()
    const i = this.state.features.findIndex((x) => x.id === f.id)
    if (i >= 0) this.state.features[i] = f
    else this.state.features.push(f)
    this.persist()
    return f
  }

  removeFeature(id: string): void {
    this.state.features = this.state.features.filter((f) => f.id !== id)
    this.threadCache.delete(id)
    const file = join(dir(), 'threads', `${id}.json`)
    if (existsSync(file)) unlinkSync(file)
    this.persist()
  }

  // ---- threads ----
  thread(featureId: string): ChatItem[] {
    let t = this.threadCache.get(featureId)
    if (t) return t
    const file = join(dir(), 'threads', `${featureId}.json`)
    try {
      t = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ChatItem[]) : []
    } catch {
      t = []
    }
    for (const item of t) {
      if (item.tool?.status === 'running') item.tool.status = 'error'
      if (item.status === 'running') item.status = item.role === 'system' ? 'error' : undefined
    }
    this.threadCache.set(featureId, t)
    return t
  }

  upsertItem(featureId: string, item: ChatItem): void {
    const t = this.thread(featureId)
    const i = t.findIndex((x) => x.id === item.id)
    if (i >= 0) t[i] = item
    else t.push(item)
    this.scheduleThread(featureId)
  }

  clearThread(featureId: string): void {
    this.threadCache.set(featureId, [])
    this.scheduleThread(featureId)
  }

  private scheduleThread(featureId: string): void {
    const existing = this.threadTimers.get(featureId)
    if (existing) clearTimeout(existing)
    this.threadTimers.set(
      featureId,
      setTimeout(() => this.flushThread(featureId), 400)
    )
  }

  private flushThread(featureId: string): void {
    const timer = this.threadTimers.get(featureId)
    if (timer) clearTimeout(timer)
    this.threadTimers.delete(featureId)
    const t = this.threadCache.get(featureId)
    if (!t) return
    atomicWrite(join(dir(), 'threads', `${featureId}.json`), JSON.stringify(t))
  }
}

let instance: Store | null = null
export function store(): Store {
  if (!instance) instance = new Store()
  return instance
}
