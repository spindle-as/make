import { contextBridge, ipcRenderer } from 'electron'
import type { Api, Events } from '@shared/types'

// Every Api method maps to an `api:<name>` IPC handler that returns {ok, value|error}.
const api = new Proxy({} as Api, {
  get(_t, prop: string) {
    if (prop === 'on') {
      return <K extends keyof Events>(channel: K, cb: (payload: Events[K]) => void) => {
        const listener = (_e: unknown, payload: Events[K]) => cb(payload)
        ipcRenderer.on(`evt:${channel}`, listener)
        return () => ipcRenderer.removeListener(`evt:${channel}`, listener)
      }
    }
    return async (...args: unknown[]) => {
      const r = await ipcRenderer.invoke(`api:${prop}`, ...args)
      if (!r.ok) throw new Error(r.error)
      return r.value
    }
  }
})

const menu = {
  onAction(cb: (id: string) => void) {
    const l = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('menu:action', l)
    return () => ipcRenderer.removeListener('menu:action', l)
  }
}

// contextBridge can't clone a Proxy, so expose concrete functions.
const methods = [
  'getSettings', 'saveSettings', 'setSecret', 'checkTools', 'updateState', 'setBadge', 'checkForUpdates', 'downloadUpdate', 'installUpdate', 'integrations', 'integrationAction', 'connectPloi',
  'listModels', 'setZoom', 'promoteToFeature', 'cleanupFeature', 'dbServices', 'projectDbInfo', 'ploiAllSites', 'suggestPloiSites', 'linkPloiSite', 'pickDirectory', 'openExternal', 'openInEditor',
  'openInFinder', 'openInTerminal', 'listProjects', 'addProject', 'updateProject', 'removeProject', 'listFeatures',
  'createFeature', 'updateFeature', 'rerunSetup', 'archiveFeature', 'getThread', 'sendPrompt', 'stopAgent',
  'clearThread', 'agentStatuses', 'gitStatus', 'gitDiff', 'commit', 'suggestCommitMessage', 'push', 'syncWithBase',
  'discardFile', 'createPr', 'getPr', 'mergePr', 'listRuns', 'failedRunLog', 'rerunFailed', 'herdSites', 'herdLink',
  'herdUnlink', 'ploiServers', 'ploiSites', 'deploy', 'deploymentStatus', 'readLocalLog', 'readRemoteLog',
  'clearLocalLog', 'mcpStatus', 'installMcp', 'runCommand', 'on', 'pendingRequests', 'respondPermission', 'answerQuestion',
  'deployStates', 'deployHistory', 'deploymentLog', 'listProcesses', 'processOutput', 'startService', 'stopProcess', 'restartProcess',
  'removeProcess', 'writeProcessInput', 'githubRepos', 'openGithubRepo', 'createLaravelProject', 'prepareProject', 'refreshAccess',
  'mailList', 'mailGet', 'mailClear', 'mailServerInfo', 'dbTables', 'dbRows', 'dbQuery', 'dbSnapshots', 'dbSnapshot', 'dbRestore', 'dbReset',
  'checkChanges', 'cancelChecks', 'draftPr', 'addVisualNote', 'ensureServices', 'webServerStatus', 'trustCertificates', 'mainSite', 'authUsers', 'loginAs', 'logoutPreview', 'harness', 'devEnv', 'saveDevEnv', 'detectDevEnv', 'aiDetectDevEnv', 'trustDevEnv'
] as const satisfies readonly (keyof Api)[]

// Compile error here means a new Api method was not added to `methods`.
type Missing = Exclude<keyof Api, (typeof methods)[number]>
const _complete: [Missing] extends [never] ? true : Missing = true
void _complete

const exposed: Record<string, unknown> = {}
for (const m of methods) exposed[m] = (api as unknown as Record<string, unknown>)[m]

contextBridge.exposeInMainWorld('api', exposed)
contextBridge.exposeInMainWorld('menu', menu)
