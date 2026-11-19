import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Api, Events } from '@shared/types'
import { loadShellEnv } from './env'
import { Factory } from './factory'
import * as db from './db'
import * as git from './git'
import * as github from './github'
import * as herd from './herd'
import * as logs from './logs'
import { PloiClient } from './ploi'
import { store } from './store'
import { Updater } from './updater'

loadShellEnv()
app.setName('Spindle Make')
// Carry data over from the app's previous name (Software Factory) on first launch.
{
  const appData = app.getPath('appData')
  const oldDir = join(appData, 'Software Factory')
  const newDir = join(appData, 'Spindle Make')
  if (!process.env.SF_USER_DATA && existsSync(oldDir) && !existsSync(newDir)) {
    try {
      renameSync(oldDir, newDir)
    } catch {
      app.setPath('userData', oldDir)
    }
  }
}
// Lets tests/smoke runs use an isolated data dir instead of the real one.
if (process.env.SF_USER_DATA) app.setPath('userData', process.env.SF_USER_DATA)

let win: BrowserWindow | null = null

function emit<K extends keyof Events>(channel: K, payload: Events[K]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(`evt:${channel}`, payload)
}

/** Light/dark: native chrome (menus, scrollbars, dialogs) follows the same choice as the page. */
function applyTheme(theme: 'system' | 'light' | 'dark' | undefined): void {
  nativeTheme.themeSource = theme ?? 'system'
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground())
}
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0e0e10' : '#ffffff')

const factory = new Factory(emit)
const updater = new Updater({
  currentVersion: app.getVersion(),
  packaged: app.isPackaged,
  execPath: process.execPath,
  workDir: join(app.getPath('userData'), 'updates'),
  onChange: (s) => emit('update:changed', s)
})

type Handlers = Omit<Api, 'on'>

const ploi = () => {
  const token = store().getSecret('ploi')
  if (!token) throw new Error('Add your Ploi API token in Settings first.')
  return new PloiClient(token)
}

const repoOf = (projectId: string) => {
  const r = store().project(projectId).githubRepo
  if (!r) throw new Error('Project has no GitHub repo configured')
  return r
}

const handlers: Handlers = {
  // app
  getSettings: async () => store().getSettings(),
  saveSettings: async (patch) => {
    const next = store().saveSettings(patch)
    if (patch.theme) applyTheme(next.theme)
    return next
  },
  setSecret: async (key, value) => store().setSecret(key, value),
  checkTools: () => factory.checkTools(),
  updateState: async () => updater.get(),
  setBadge: async (count) => {
    app.dock?.setBadge(count > 0 ? String(count) : '')
  },
  checkForUpdates: () => updater.check(),
  downloadUpdate: () => updater.download(),
  installUpdate: async () => {
    updater.install()
    // Let the reply reach the window, then quit; the helper swaps the app and relaunches it.
    setTimeout(() => app.quit(), 150)
  },
  integrations: () => factory.integrations(),
  integrationAction: (id, action) => factory.integrationAction(id, action),
  connectPloi: (token) => factory.connectPloi(token),
  listModels: async () => factory.listModels(),
  setZoom: async (scale) => applyZoom(scale),
  pickDirectory: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  openExternal: async (url) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  },
  openInEditor: (p) => factory.openInEditor(p),
  openInFinder: (p) => factory.openInFinder(p),
  openInTerminal: (p) => factory.openInTerminal(p),

  // onboarding & access
  githubRepos: (q) => factory.githubRepos(q),
  openGithubRepo: (name) => factory.openGithubRepo(name),
  createLaravelProject: (name) => factory.createLaravelProject(name),
  prepareProject: (id) => factory.prepareProject(id),
  refreshAccess: (id) => factory.refreshAccess(id),

  // mail
  mailList: async (featureId) => factory.mail.list(factory.mailKey(featureId)),
  mailGet: async (id) => factory.mail.get(id),
  mailClear: async (featureId) => factory.mail.clear(factory.mailKey(featureId)),
  mailServerInfo: async () => ({ port: factory.mail.port }),

  // database browser
  dbTables: (id) => factory.dbTables(id),
  dbRows: (id, table, page) => factory.dbRows(id, table, page),
  dbQuery: (id, sql, allowWrite) => factory.dbQuery(id, sql, allowWrite),
  dbSnapshots: async (id) => factory.dbSnapshots(id),
  dbSnapshot: (id, label) => factory.dbSnapshot(id, label),
  dbRestore: (id, snap) => factory.dbRestore(id, snap),
  dbReset: (id) => factory.dbReset(id),

  // review
  cancelChecks: (id) => factory.cancelChecks(id),
  checkChanges: (id) => factory.checkChanges(id),
  draftPr: (id) => factory.draftPr(id),
  addVisualNote: async (id, note) => factory.addVisualNote(id, note),

  // projects
  listProjects: async () => store().projects(),
  addProject: ({ path }) => factory.addProject(path),
  updateProject: async (id, patch) => factory.updateProject(id, patch),
  removeProject: async (id) => {
    for (const f of store().features().filter((f) => f.projectId === id)) factory.agents.stop(f.id)
    store().removeProject(id)
  },

  // features
  listFeatures: async () => store().features(),
  createFeature: (input) => factory.createFeature(input),
  updateFeature: async (id, patch) => {
    // A manual rename locks the title so auto-titling never overwrites it.
    const f = { ...store().feature(id), ...patch, ...(patch.title ? { titleLocked: true } : {}), id }
    store().upsertFeature(f)
    emit('feature:changed', f)
    return f
  },
  rerunSetup: async (id) => {
    await factory.runSetup(id)
  },
  archiveFeature: (id, opts) => factory.archiveFeature(id, opts),
  promoteToFeature: (id) => factory.promoteToFeature(id),
  cleanupFeature: (id) => factory.cleanupFeature(id, 'manual'),
  dbServices: () => db.dbnginServices(),
  projectDbInfo: async (projectId) => db.describeProjectDb(store().project(projectId).path),

  // agent
  getThread: async (id) => store().thread(id),
  sendPrompt: async (id, prompt, attachments) => factory.sendPrompt(id, prompt, attachments ?? []),
  stopAgent: async (id) => factory.agents.stop(id),
  pendingRequests: async () => factory.pendingRequests(),
  respondPermission: async (featureId, requestId, decision, message) => factory.respondPermission(featureId, requestId, decision, message),
  answerQuestion: async (featureId, requestId, answers) => factory.answerQuestion(featureId, requestId, answers),
  clearThread: async (id) => {
    store().clearThread(id)
    const f = store().feature(id)
    const next = { ...f, sessionId: undefined }
    store().upsertFeature(next)
    emit('feature:changed', next)
  },
  agentStatuses: async () => factory.agents.allStatuses(),

  // git
  gitStatus: async (id) => {
    const f = store().feature(id)
    return git.status(f.worktreePath, f.baseBranch)
  },
  gitDiff: async (id, file) => {
    const f = store().feature(id)
    return git.diff(f.worktreePath, f.baseBranch, file)
  },
  commit: async (id, message) => git.commitAll(store().feature(id).worktreePath, message),
  suggestCommitMessage: (id) => factory.suggestCommitMessage(id),
  push: async (id) => {
    const f = store().feature(id)
    return git.push(f.worktreePath, f.branch)
  },
  syncWithBase: async (id) => {
    const f = store().feature(id)
    return git.syncWithBase(f.worktreePath, f.baseBranch)
  },
  discardFile: async (id, file) => {
    const f = store().feature(id)
    return git.discardFile(f.worktreePath, file, f.baseBranch)
  },

  // github
  createPr: (id, input) => factory.createPr(id, input),
  getPr: (id) => factory.getPr(id),
  mergePr: (id) => factory.mergePr(id),
  listRuns: async (id) => {
    const f = store().feature(id)
    const p = f.projectId ? store().project(f.projectId) : null
    if (!p?.githubRepo || f.kind === 'chat') return []
    return github.listRuns(p.githubRepo, f.branch)
  },
  failedRunLog: async (runId, projectId) => github.failedRunLog(repoOf(projectId), runId),
  rerunFailed: async (runId, projectId) => github.rerunFailed(repoOf(projectId), runId),

  // herd
  herdSites: () => herd.sites(),
  herdLink: async (id) => {
    await factory.runSetup(id)
    return store().feature(id).localUrl ?? ''
  },
  herdUnlink: async (id) => {
    const f = store().feature(id)
    if (f.herdSite) await herd.unlink(f.worktreePath, f.herdSite)
    const next = { ...f, herdSite: undefined, localUrl: undefined }
    store().upsertFeature(next)
    emit('feature:changed', next)
  },

  // ploi
  ploiServers: async () => ploi().servers(),
  ploiSites: async (serverId) => ploi().sites(serverId),
  ploiAllSites: () => factory.ploiAllSites(),
  suggestPloiSites: (projectId) => factory.suggestPloiSites(projectId),
  linkPloiSite: async (projectId, ref) => factory.linkPloiSite(projectId, ref),
  deploy: (projectId, envId, featureId) => factory.deploy(projectId, envId, featureId),
  deploymentStatus: (projectId, envId) => factory.deploymentStatus(projectId, envId),
  deployStates: async () => factory.deployStates(),
  deployHistory: (projectId, envId) => factory.deployHistory(projectId, envId),
  deploymentLog: (projectId, envId, id) => factory.deploymentLog(projectId, envId, id),

  // logs
  readLocalLog: async (id, lines) => logs.tailLocal(store().feature(id).worktreePath, lines),
  readRemoteLog: (projectId, envId, lines) => factory.readRemoteLog(projectId, envId, lines),
  clearLocalLog: async (id) => logs.clearLocal(store().feature(id).worktreePath),
  mcpStatus: () => factory.mcpStatus(),
  installMcp: (name, agent) => factory.installMcp(name, agent),

  // terminal
  listProcesses: async (featureId) => factory.processes.list(featureId),
  processOutput: async (id) => factory.processes.output(id),
  runCommand: async (id, command) => factory.runCommand(id, command),
  startService: async (featureId, name) => factory.startService(featureId, name),
  ensureServices: async (featureId) => factory.ensureServices(featureId),
  webServerStatus: () => factory.webServerStatus(),
  trustCertificates: () => factory.trustCertificates(),
  mainSite: (projectId) => factory.mainSite(projectId),
  authUsers: (target, query) => factory.authUsers(target, query),
  loginAs: (target, userId, partition, url) => factory.loginAs(target, userId, partition, url),
  logoutPreview: (partition, url) => factory.logoutPreview(partition, url),
  harness: async (projectId, agent) => factory.harness(projectId, agent),
  devEnv: async (projectId, featureId) => factory.devEnv(projectId, featureId),
  saveDevEnv: async (projectId, config, instructions, baseHash) => factory.saveDevEnv(projectId, config, instructions, baseHash),
  detectDevEnv: async (projectId) => factory.detectDevEnv(projectId),
  aiDetectDevEnv: (projectId) => factory.aiDetectDevEnv(projectId),
  trustDevEnv: async (projectId, featureId) => factory.trustDevEnv(projectId, featureId),
  stopProcess: (id) => factory.processes.stop(id),
  restartProcess: async (id) => (await factory.processes.restart(id)).id,
  removeProcess: (id) => factory.processes.remove(id),
  writeProcessInput: async (id, text) => factory.processes.write(id, text)
}

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`api:${name}`, async (_e, ...args: unknown[]) => {
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: windowBackground(),
    title: 'Spindle / Make',
    vibrancy: 'under-window',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })
  win.on('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(store().getSettings().uiScale || 1))
  // Preview/Nightwatch webviews load arbitrary sites: never give them Node or a preload.
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    if (!/^https?:\/\//.test(params.src)) _e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function applyZoom(scale: number): number {
  const z = Math.min(1.6, Math.max(0.8, Math.round(scale * 20) / 20))
  for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(z)
  const settings = store().saveSettings({ uiScale: z })
  emit('settings:changed', settings)
  return z
}

/**
 * Menu items show their shortcut but don't register it (registerAccelerator: false):
 * the renderer owns all key handling, so shortcuts behave the same from menu or keyboard.
 */
function buildMenu(): void {
  const action = (id: string) => () => win?.webContents.send('menu:action', id)
  const item = (label: string, id: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: action(id)
  })
  const sep: Electron.MenuItemConstructorOptions = { type: 'separator' }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { label: 'About Spindle / Make', role: 'about' },
        item('Check for Updates…', 'check-updates'),
        sep,
        item('Settings…', 'settings', 'CmdOrCtrl+,'),
        item('Integrations…', 'integrations'),
        sep,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        item('New Feature', 'new-feature', 'CmdOrCtrl+N'),
        item('New Chat', 'new-chat', 'CmdOrCtrl+Shift+N'),
        item('Open Project…', 'add-project', 'CmdOrCtrl+O'),
        sep,
        item('Command Palette…', 'palette', 'CmdOrCtrl+K'),
        sep,
        item('Archive Thread…', 'archive', 'CmdOrCtrl+Backspace'),
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Thread',
      submenu: [
        item('Focus Composer', 'focus-composer', 'CmdOrCtrl+L'),
        item('Choose Model…', 'model-picker', 'CmdOrCtrl+Shift+M'),
        item('Stop Agent', 'stop', 'CmdOrCtrl+.'),
        sep,
        item('Previous Thread', 'prev-thread', 'Alt+Up'),
        item('Next Thread', 'next-thread', 'Alt+Down'),
        sep,
        item('Open in Editor', 'open-editor', 'CmdOrCtrl+E'),
        item('Open in Terminal', 'open-terminal', 'CmdOrCtrl+Shift+T'),
        item('Open Local Site', 'open-site', 'CmdOrCtrl+Shift+B'),
        sep,
        item('Continue Chat as Feature', 'promote')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Creator / Developer Mode', 'toggle-mode', 'CmdOrCtrl+Shift+D'),
        sep,
        item('Toggle Sidebar', 'toggle-sidebar', 'CmdOrCtrl+B'),
        item('Toggle Panel', 'toggle-panel', 'CmdOrCtrl+J'),
        sep,
        item('Preview', 'tab-preview', 'CmdOrCtrl+Alt+1'),
        item('Changes', 'tab-changes', 'CmdOrCtrl+Alt+2'),
        item('Review / Ship', 'tab-ship', 'CmdOrCtrl+Alt+3'),
        item('Email', 'tab-email', 'CmdOrCtrl+Alt+4'),
        item('Data', 'tab-data', 'CmdOrCtrl+Alt+5'),
        item('Logs', 'tab-logs', 'CmdOrCtrl+Alt+6'),
        item('Processes', 'tab-terminal', 'CmdOrCtrl+Alt+7'),
        item('Setup', 'tab-setup', 'CmdOrCtrl+Alt+8'),
        sep,
        item('Bigger Text', 'zoom-in', 'CmdOrCtrl+Plus'),
        item('Smaller Text', 'zoom-out', 'CmdOrCtrl+-'),
        item('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
        sep,
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as Electron.MenuItemConstructorOptions[]))
      ]
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [item('Keyboard Shortcuts', 'shortcuts', 'CmdOrCtrl+/')] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  applyTheme(store().getSettings().theme)
  buildMenu()
  createWindow()
  // Old builds kept tokens in safeStorage; move them to the Keychain without blocking startup.
  void store()
    .loadSecrets()
    .then(() => store().migrateLegacySecrets())
    .then(() => emit('settings:changed', store().getSettings()))
    .catch((e) => console.error('secrets', e))
    .finally(() => factory.startDeployRefresh())
  factory.refreshAllAccess()
  factory.syncAllEnvMirrors()
  void factory.mail.start().catch((e) => console.error('mail catcher', e))
  void factory.startWebServer()
  updater.startSchedule(() => store().getSettings().autoUpdate !== false)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// The preview trusts Spindle's own local certificates (only for *.localhost sites it issued),
// so HTTPS works in-app even before the CA is added to the macOS keychain.
app.on('certificate-error', (event, _wc, url, _error, certificate, callback) => {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    /* ignore */
  }
  let ours = false
  try {
    ours = host.endsWith('.localhost') && certificate.issuerCert?.fingerprint === factory.ca.fingerprint()
  } catch {
    ours = false
  }
  if (ours) {
    event.preventDefault()
    callback(true)
  } else callback(false)
})

app.on('before-quit', () => factory.shutdown())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
// A terminal kill (or logout) shouldn't orphan dev servers and PHP backends: quit cleanly instead.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sig, () => app.quit())
// A bug in a background timer shouldn't take over the screen with a crash dialog: log it and tell the user.
process.on('uncaughtException', (e) => {
  console.error('Uncaught exception', e)
  emit('toast', { kind: 'error', message: `Something went wrong in the background: ${e.message}` })
})
process.on('unhandledRejection', (e) => console.error('Unhandled rejection', e))
