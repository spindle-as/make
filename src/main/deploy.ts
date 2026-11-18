import type { DeployState, Environment, Project } from '@shared/types'
import type { PloiClient } from './ploi'

type Key = string
const key = (projectId: string, envId: string): Key => `${projectId}:${envId}`
const RUNNING = new Set(['deploying', 'queued', 'scheduled', 'pending'])

export interface DeployHooks {
  client(): PloiClient | null
  save(s: DeployState): void
  changed(s: DeployState): void
  finished(s: DeployState): void
}

/**
 * Live deployment state per environment. Ploi doesn't list a deployment until it has
 * finished, so running deploys are followed by id (ours) or by the site's status
 * (deploys Ploi started itself, e.g. auto-deploy after a push to the branch).
 */
export class DeployTracker {
  private states = new Map<Key, DeployState>()
  private timers = new Map<Key, NodeJS.Timeout>()

  constructor(
    private hooks: DeployHooks,
    initial: DeployState[] = []
  ) {
    for (const s of initial) this.states.set(key(s.projectId, s.envId), s)
  }

  all(): DeployState[] {
    return [...this.states.values()]
  }

  get(projectId: string, envId: string): DeployState | undefined {
    return this.states.get(key(projectId, envId))
  }

  private set(s: DeployState): void {
    this.states.set(key(s.projectId, s.envId), s)
    this.hooks.save(s)
    this.hooks.changed(s)
  }

  private stopTimer(k: Key): void {
    const t = this.timers.get(k)
    if (t) clearInterval(t)
    this.timers.delete(k)
  }

  isRunning(projectId: string, envId: string): boolean {
    const s = this.get(projectId, envId)
    return !!s && (s.status === 'queued' || s.status === 'deploying')
  }

  /** Trigger a deploy through Ploi and follow it until it finishes. */
  async trigger(project: Project, env: Environment, featureId?: string): Promise<DeployState> {
    const client = this.hooks.client()
    if (!client) throw new Error('Connect Ploi in Settings → Integrations first.')
    if (!env.ploiServerId || !env.ploiSiteId) throw new Error('This environment is not linked to a Ploi site yet.')
    if (this.isRunning(project.id, env.id)) throw new Error(`${env.name} is already deploying.`)
    const base: DeployState = { projectId: project.id, envId: env.id, status: 'queued', source: 'app', featureId, startedAt: Date.now() }
    this.set(base)
    try {
      const r = await client.deploy(env.ploiServerId, env.ploiSiteId)
      const s: DeployState = { ...base, status: 'deploying', deploymentId: r.deploymentId, message: r.message }
      this.set(s)
      this.follow(project, env)
      return s
    } catch (e) {
      const s: DeployState = { ...base, status: 'failed', finishedAt: Date.now(), error: (e as Error).message }
      this.set(s)
      this.hooks.finished(s)
      throw e
    }
  }

  /** Poll a running deployment (by id when we have one, otherwise by site status + history). */
  private follow(project: Project, env: Environment, opts: { watchMinutes?: number; baselineId?: string; featureId?: string } = {}): void {
    const k = key(project.id, env.id)
    this.stopTimer(k)
    const started = Date.now()
    const limit = (opts.watchMinutes ?? 30) * 60_000
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const client = this.hooks.client()
        const cur = this.get(project.id, env.id)
        if (!client || !env.ploiServerId || !env.ploiSiteId) return this.stopTimer(k)
        if (Date.now() - started > limit) {
          if (cur && cur.status === 'deploying') this.set({ ...cur, status: 'failed', finishedAt: Date.now(), error: 'Timed out waiting for Ploi' })
          return this.stopTimer(k)
        }
        if (cur?.deploymentId && cur.status === 'deploying') {
          const d = await client.deployment(env.ploiServerId, env.ploiSiteId, cur.deploymentId)
          if (RUNNING.has(d.status)) return
          this.finish({ ...cur, status: d.status === 'success' ? 'success' : 'failed', commit: d.commit ?? cur.commit, message: d.message || cur.message, log: d.log })
          return this.stopTimer(k)
        }
        // No id: a deploy Ploi started on its own. Watch the site status and the history.
        const site = await client.site(env.ploiServerId, env.ploiSiteId).catch(() => ({ status: undefined }))
        if (site.status && /deploy/i.test(site.status)) {
          if (!cur || cur.status !== 'deploying') {
            this.set({ projectId: project.id, envId: env.id, status: 'deploying', source: 'ploi', featureId: opts.featureId, startedAt: Date.now() })
          }
          return
        }
        const latest = (await client.deployments(env.ploiServerId, env.ploiSiteId, 1))[0]
        if (latest?.id && latest.id !== opts.baselineId && latest.id !== cur?.deploymentId) {
          const log = await client.deploymentLog(env.ploiServerId, env.ploiSiteId, latest.id).catch(() => undefined)
          this.finish({
            projectId: project.id,
            envId: env.id,
            source: cur?.status === 'deploying' ? cur.source : 'ploi',
            featureId: opts.featureId ?? cur?.featureId,
            startedAt: cur?.status === 'deploying' ? cur.startedAt : latest.at ? Date.parse(latest.at) : undefined,
            status: latest.status === 'success' ? 'success' : 'failed',
            deploymentId: latest.id,
            commit: latest.commit,
            message: latest.message,
            log
          })
          return this.stopTimer(k)
        }
      } catch {
        /* transient network/API error: keep polling */
      } finally {
        busy = false
      }
    }
    this.timers.set(k, setInterval(tick, 4000))
    void tick()
  }

  private finish(s: DeployState): void {
    const done = { ...s, finishedAt: Date.now() }
    this.set(done)
    this.hooks.finished(done)
  }

  /**
   * After a merge, Ploi may deploy by itself (auto-deploy on push). Watch for a while so
   * the deploy shows up live even though this app didn't start it.
   */
  async watchForExternal(project: Project, env: Environment, featureId?: string, minutes = 10): Promise<void> {
    const client = this.hooks.client()
    if (!client || !env.ploiServerId || !env.ploiSiteId || this.isRunning(project.id, env.id)) return
    const baseline = (await client.deployments(env.ploiServerId, env.ploiSiteId, 1).catch(() => []))[0]?.id
    this.follow(project, env, { watchMinutes: minutes, baselineId: baseline ?? this.get(project.id, env.id)?.deploymentId, featureId })
  }

  /** Bring the "last deployed" info up to date (start-up and periodic refresh). */
  async refresh(project: Project, env: Environment): Promise<void> {
    const client = this.hooks.client()
    if (!client || !env.ploiServerId || !env.ploiSiteId) return
    const cur = this.get(project.id, env.id)
    if (cur && (cur.status === 'deploying' || cur.status === 'queued')) {
      // Resume following a deploy that was running when the app quit.
      if (!this.timers.has(key(project.id, env.id))) this.follow(project, env, { baselineId: cur.deploymentId })
      return
    }
    const site = await client.site(env.ploiServerId, env.ploiSiteId).catch(() => ({ status: undefined }))
    if (site.status && /deploy/i.test(site.status)) return this.watchForExternal(project, env, undefined, 30)
    const latest = (await client.deployments(env.ploiServerId, env.ploiSiteId, 1).catch(() => []))[0]
    if (!latest?.id || latest.id === cur?.deploymentId) return
    this.set({
      projectId: project.id,
      envId: env.id,
      status: latest.status === 'success' ? 'success' : 'failed',
      source: 'ploi',
      deploymentId: latest.id,
      commit: latest.commit,
      message: latest.message,
      finishedAt: latest.at ? Date.parse(latest.at) : Date.now()
    })
  }

  stopAll(): void {
    for (const k of [...this.timers.keys()]) this.stopTimer(k)
  }
}
