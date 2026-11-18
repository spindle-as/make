import type { DeployResult, DeploymentInfo, Environment, PloiServer, PloiSite, PloiSiteRef, Project } from '@shared/types'
import { slugify, uid } from '@shared/util'

const BASE = 'https://ploi.io/api'

export class PloiClient {
  constructor(private token: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    let json: any = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { message: text }
    }
    if (!res.ok) {
      const detail = json.message || json.error || text || res.statusText
      if (res.status === 401) throw new Error('Ploi rejected the API token (401). Update it in Settings.')
      if (res.status === 403) throw new Error(`Ploi token is missing a scope (403): ${detail}`)
      if (res.status === 429) throw new Error('Ploi rate limit hit (429). Try again in a minute.')
      throw new Error(`Ploi ${method} ${path} → ${res.status}: ${detail}`)
    }
    return json as T
  }

  /** Follow Ploi's `links.next` pagination for list endpoints. */
  private async all<T>(path: string): Promise<T[]> {
    const out: T[] = []
    let page = 1
    for (;;) {
      const sep = path.includes('?') ? '&' : '?'
      const r = await this.req<{ data: T[]; meta?: { last_page?: number } }>('GET', `${path}${sep}page=${page}&per_page=50`)
      out.push(...(r.data ?? []))
      if (!r.meta?.last_page || page >= r.meta.last_page || page > 20) break
      page++
    }
    return out
  }

  servers(): Promise<PloiServer[]> {
    return this.all<PloiServer>('/servers')
  }

  sites(serverId: string): Promise<PloiSite[]> {
    return this.all<PloiSite>(`/servers/${serverId}/sites`)
  }

  /** Every site on every server, flattened — powers the single "pick your site" list. */
  async allSites(): Promise<PloiSiteRef[]> {
    const servers = await this.servers()
    const lists = await Promise.all(
      servers.map(async (srv) => {
        const sites = await this.sites(String(srv.id)).catch(() => [] as PloiSite[])
        return sites.map(
          (site): PloiSiteRef => ({
            serverId: String(srv.id),
            serverName: srv.name,
            serverIp: srv.ip_address,
            siteId: String(site.id),
            domain: site.domain,
            systemUser: site.system_user
          })
        )
      })
    )
    return lists.flat()
  }

  async deploy(serverId: string, siteId: string): Promise<DeployResult & { deploymentId?: string }> {
    const r = await this.req<{ message?: string; deployment_id?: string }>(
      'POST',
      `/servers/${serverId}/sites/${siteId}/deploy`
    )
    return { ok: true, message: r.message ?? 'Deployment queued', deploymentId: r.deployment_id }
  }

  async deployment(serverId: string, siteId: string, deploymentId: string): Promise<DeploymentInfo> {
    const r = await this.req<{ data: Record<string, any> }>(
      'GET',
      `/servers/${serverId}/sites/${siteId}/deployments/${deploymentId}`
    )
    const d = r.data ?? {}
    const info: DeploymentInfo = {
      id: d.id ?? deploymentId,
      status: d.status ?? 'unknown',
      message: d.commit_message ?? '',
      commit: d.commit_hash ?? undefined,
      at: d.created_at ?? undefined
    }
    if (info.status !== 'deploying') {
      try {
        const log = await this.req<{ data: { content?: string } }>(
          'GET',
          `/servers/${serverId}/sites/${siteId}/deployments/${deploymentId}/log`
        )
        info.log = log.data?.content
      } catch {
        // log becomes available shortly after finishing
      }
    }
    return info
  }

  async site(serverId: string, siteId: string): Promise<{ status?: string; last_deploy_at?: string }> {
    const r = await this.req<{ data: { status?: string; last_deploy_at?: string } }>('GET', `/servers/${serverId}/sites/${siteId}`)
    return r.data ?? {}
  }

  /** Finished deployments, newest first. */
  async deployments(serverId: string, siteId: string, perPage = 10): Promise<DeploymentInfo[]> {
    const r = await this.req<{ data: Record<string, any>[] }>('GET', `/servers/${serverId}/sites/${siteId}/deployments?per_page=${perPage}`)
    return (r.data ?? []).map((d) => ({
      id: d.id,
      status: d.status,
      message: d.commit_message ?? '',
      commit: d.commit_hash ?? undefined,
      at: d.created_at ?? undefined
    }))
  }

  async deploymentLog(serverId: string, siteId: string, deploymentId: string): Promise<string> {
    const r = await this.req<{ data: { content?: string } }>('GET', `/servers/${serverId}/sites/${siteId}/deployments/${deploymentId}/log`)
    return r.data?.content ?? ''
  }

  /** Latest finished deployment (running deployments are not listed by Ploi). */
  async latestDeployment(serverId: string, siteId: string): Promise<DeploymentInfo | null> {
    const r = await this.req<{ data: Record<string, any>[] }>(
      'GET',
      `/servers/${serverId}/sites/${siteId}/deployments?per_page=1&include_logs=true`
    )
    const d = r.data?.[0]
    if (!d) return null
    return {
      id: d.id,
      status: d.status,
      message: d.commit_message ?? '',
      commit: d.commit_hash ?? undefined,
      at: d.created_at,
      log: d.log_content ?? undefined
    }
  }
}

const tokens = (s: string) => slugify(s, 200).split('-').filter((t) => t.length > 2 && !['www', 'app', 'com', 'net', 'org', 'test', 'dev'].includes(t))

/** Rank sites by how likely they belong to the project (name / repo name vs. domain). */
export function scoreSites(sites: PloiSiteRef[], project: Pick<Project, 'name' | 'slug' | 'githubRepo'>): PloiSiteRef[] {
  const wanted = new Set([...tokens(project.name), ...tokens(project.slug), ...tokens(project.githubRepo?.split('/')[1] ?? '')])
  return sites
    .map((site) => {
      const domainTokens = tokens(site.domain.replace(/\.[a-z]+$/, ''))
      let score = 0
      for (const t of domainTokens) if (wanted.has(t)) score += 10
      for (const w of wanted) if (site.domain.includes(w)) score += 3
      return { ...site, score }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.domain.localeCompare(b.domain))
}

/** Build an environment from a Ploi site with sensible defaults (URL, ssh target, path). */
export function environmentFromSite(ref: PloiSiteRef, defaultBranch: string, existing: Environment[]): Environment {
  const isStaging = /(^|[.-])(staging|stage|test|dev|preview)([.-]|$)/.test(ref.domain)
  let name = isStaging ? 'staging' : 'production'
  if (existing.some((e) => e.name === name)) name = ref.domain
  const user = ref.systemUser || 'ploi'
  return {
    id: uid('e_'),
    name,
    branch: defaultBranch,
    ploiServerId: ref.serverId,
    ploiSiteId: ref.siteId,
    url: `https://${ref.domain}`,
    sshTarget: ref.serverIp ? `${user}@${ref.serverIp}` : undefined,
    remotePath: `/home/${user}/${ref.domain}`,
    autoDeployOnMerge: false
  }
}
