import { afterEach, describe, expect, it, vi } from 'vitest'
import { PloiClient } from '../src/main/ploi'

type Call = { url: string; method: string; auth: string | null }
function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    calls.push({ url, method: init.method ?? 'GET', auth: headers.get('Authorization') })
    const key = `${init.method ?? 'GET'} ${url.replace('https://ploi.io/api', '')}`
    const route = routes[key]
    if (!route) return new Response(JSON.stringify({ message: 'not found ' + key }), { status: 404 })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('PloiClient', () => {
  it('paginates servers with bearer auth', async () => {
    const calls = mockFetch({
      'GET /servers?page=1&per_page=50': { body: { data: [{ id: 1, name: 'web-1' }], meta: { last_page: 2 } } },
      'GET /servers?page=2&per_page=50': { body: { data: [{ id: 2, name: 'web-2' }], meta: { last_page: 2 } } }
    })
    const servers = await new PloiClient('tok').servers()
    expect(servers.map((s) => s.name)).toEqual(['web-1', 'web-2'])
    expect(calls[0].auth).toBe('Bearer tok')
  })

  it('deploys and polls a deployment, fetching the log once finished', async () => {
    mockFetch({
      'POST /servers/1/sites/9/deploy': { body: { message: 'queued for deployment', deployment_id: 'dep-1' } },
      'GET /servers/1/sites/9/deployments/dep-1': { body: { data: { id: 'dep-1', status: 'success', commit_hash: 'abc1234', commit_message: 'feat: x' } } },
      'GET /servers/1/sites/9/deployments/dep-1/log': { body: { data: { content: 'Deploying...\nDone' } } }
    })
    const c = new PloiClient('tok')
    const r = await c.deploy('1', '9')
    expect(r).toMatchObject({ ok: true, deploymentId: 'dep-1' })
    const info = await c.deployment('1', '9', 'dep-1')
    expect(info).toMatchObject({ status: 'success', commit: 'abc1234', message: 'feat: x', log: 'Deploying...\nDone' })
  })

  it('does not fetch logs while deploying', async () => {
    const calls = mockFetch({ 'GET /servers/1/sites/9/deployments/d': { body: { data: { id: 'd', status: 'deploying' } } } })
    const info = await new PloiClient('t').deployment('1', '9', 'd')
    expect(info.status).toBe('deploying')
    expect(calls).toHaveLength(1)
  })

  it('maps auth, scope and validation errors to readable messages', async () => {
    mockFetch({
      'GET /servers?page=1&per_page=50': { status: 401, body: { message: 'Unauthenticated.' } },
      'POST /servers/1/sites/9/deploy': { status: 422, body: { message: 'Site is already deploying' } },
      'GET /servers/1/sites?page=1&per_page=50': { status: 403, body: { message: 'Missing scope: sites-read' } }
    })
    const c = new PloiClient('bad')
    await expect(c.servers()).rejects.toThrow(/rejected the API token/)
    await expect(c.deploy('1', '9')).rejects.toThrow(/already deploying/)
    await expect(c.sites('1')).rejects.toThrow(/missing a scope.*sites-read/)
  })
})
