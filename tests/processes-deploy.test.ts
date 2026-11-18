import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DeployTracker } from '../src/main/deploy'
import { detectServices, ProcessManager } from '../src/main/processes'
import type { DeployState, DeploymentInfo, Environment, ProcessInfo, Project } from '../src/shared/types'

const root = mkdtempSync(join(tmpdir(), 'sf-proc-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('ProcessManager', () => {
  const changes: ProcessInfo[] = []
  let out = ''
  const pm = new ProcessManager(join(root, 'logs'), {
    onChanged: (p) => changes.push(p),
    onRemoved: () => {},
    onOutput: (_i, _f, _s, d) => (out += d)
  })

  it('streams output, logs to a file and reports exit codes', async () => {
    const p = pm.start('f1', 'echo', 'echo hello; echo oops >&2; exit 3', 'command', root)
    await wait(1500)
    const info = pm.list('f1').find((x) => x.id === p.id)!
    expect(info.status).toBe('crashed')
    expect(info.code).toBe(3)
    expect(out).toContain('hello')
    expect(readFileSync(p.logFile, 'utf8')).toContain('oops')
  })

  it('stops a long-running service and its child processes together', async () => {
    const p = pm.start('f1', 'Dev server', 'sh -c "sleep 120" & sleep 120', 'service', root)
    await wait(800)
    // starting the same service again re-uses the running one
    expect(pm.start('f1', 'Dev server', 'sleep 120', 'service', root).id).toBe(p.id)
    await pm.stop(p.id)
    await wait(300)
    expect(pm.list('f1').find((x) => x.id === p.id)?.status).toBe('stopped')
    // '[1]' keeps the pattern from matching pgrep's own command line
    let left = ''
    try {
      left = execFileSync('pgrep', ['-f', 'sleep [1]20'], { encoding: 'utf8' }).trim()
    } catch {
      left = '' // pgrep exits 1 when nothing matches
    }
    expect(left).toBe('')
  })

  it('accepts stdin for interactive commands', async () => {
    const p = pm.start('f2', 'read', 'read x; echo "got $x"', 'command', root)
    await wait(300)
    pm.write(p.id, 'yes')
    await wait(800)
    expect(pm.output(p.id)).toContain('got yes')
  })

  it('tells the agent where running service logs are', async () => {
    const p = pm.start('f3', 'Queue', 'sleep 30', 'service', root)
    await wait(200)
    expect(pm.describeFor('f3')).toContain(p.logFile)
    await pm.removeFeature('f3')
    expect(pm.list('f3')).toEqual([])
  })

  it('detects sensible default services', () => {
    const dir = join(root, 'laravel')
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(join(dir, 'artisan'), '')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    const svcs = detectServices(dir, { QUEUE_CONNECTION: 'database' })
    expect(svcs.map((s) => [s.name, s.autoStart])).toEqual([
      ['Dev server', true],
      ['Queue worker', true],
      ['Scheduler', false]
    ])
    expect(detectServices(dir, {}).find((s) => s.name === 'Queue worker')).toBeUndefined()
  })
})

describe('DeployTracker', () => {
  const project = { id: 'p', name: 'Shop' } as Project
  const env = { id: 'e', name: 'production', branch: 'main', ploiServerId: '1', ploiSiteId: '9' } as Environment

  function fakeClient(script: { deployStatuses: string[]; siteStatuses?: string[]; history?: DeploymentInfo[][] }) {
    let d = 0
    let st = 0
    let h = 0
    return {
      deploy: async () => ({ ok: true, message: 'queued', deploymentId: 'dep-1' }),
      deployment: async () => {
        const status = script.deployStatuses[Math.min(d++, script.deployStatuses.length - 1)]
        return { id: 'dep-1', status, message: 'feat: x', commit: 'abc', log: status === 'deploying' ? undefined : 'LOG' }
      },
      site: async () => ({ status: script.siteStatuses?.[Math.min(st++, (script.siteStatuses?.length ?? 1) - 1)] ?? 'active' }),
      deployments: async () => script.history?.[Math.min(h++, (script.history?.length ?? 1) - 1)] ?? [],
      deploymentLog: async () => 'EXTERNAL LOG'
    }
  }

  it('follows a deploy it started until it finishes', async () => {
    const events: DeployState[] = []
    const finished: DeployState[] = []
    const client = fakeClient({ deployStatuses: ['deploying', 'success'] })
    const t = new DeployTracker({ client: () => client as never, save: () => {}, changed: (s) => events.push(s), finished: (s) => finished.push(s) })
    await t.trigger(project, env, 'f1')
    expect(t.isRunning('p', 'e')).toBe(true)
    await expect(t.trigger(project, env)).rejects.toThrow(/already deploying/)
    await wait(4600)
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ status: 'success', source: 'app', featureId: 'f1', log: 'LOG', commit: 'abc' })
    expect(finished[0].finishedAt! >= finished[0].startedAt!).toBe(true)
    expect(events.map((e) => e.status)).toEqual(['queued', 'deploying', 'success'])
    t.stopAll()
  }, 10_000)

  it('notices a deploy Ploi started by itself after a merge', async () => {
    const finished: DeployState[] = []
    const events: DeployState[] = []
    const client = fakeClient({
      deployStatuses: ['success'],
      siteStatuses: ['deploying', 'active'],
      history: [[{ id: 'old', status: 'success', message: '' }], [{ id: 'new', status: 'failed', message: 'feat: y', commit: 'def' }]]
    })
    const t = new DeployTracker({ client: () => client as never, save: () => {}, changed: (s) => events.push(s), finished: (s) => finished.push(s) })
    await t.watchForExternal(project, env, 'f2', 1)
    await wait(4600)
    expect(events[0]).toMatchObject({ status: 'deploying', source: 'ploi' })
    expect(finished[0]).toMatchObject({ status: 'failed', deploymentId: 'new', featureId: 'f2', log: 'EXTERNAL LOG' })
    t.stopAll()
  }, 10_000)
})
