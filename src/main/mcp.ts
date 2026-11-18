import type { AgentKind, McpStatus, Settings } from '@shared/types'
import { exec, run } from './exec'

/**
 * Nightwatch has no public REST API — its official integration is an OAuth MCP
 * server. Ploi also ships one. We register them with the agent CLIs so the
 * agent can read production issues / deployments while debugging.
 */
export const MCP_SERVERS: Record<McpStatus['name'], string> = {
  nightwatch: 'https://nightwatch.laravel.com/mcp',
  ploi: 'https://ploi.io/api/mcp'
}

async function claudeHas(bin: string, name: string): Promise<boolean> {
  const r = await exec(bin, ['mcp', 'get', name], { timeoutMs: 20_000 })
  return r.code === 0
}

async function codexHas(bin: string, name: string): Promise<boolean> {
  const r = await exec(bin, ['mcp', 'list'], { timeoutMs: 20_000 })
  return r.code === 0 && new RegExp(`^\\s*${name}\\b`, 'm').test(r.stdout)
}

export async function status(settings: Settings): Promise<McpStatus[]> {
  const out: McpStatus[] = []
  for (const name of Object.keys(MCP_SERVERS) as McpStatus['name'][]) {
    out.push({ name, agent: 'claude', installed: await claudeHas(settings.claudePath || 'claude', name) })
    out.push({ name, agent: 'codex', installed: await codexHas(settings.codexPath || 'codex', name) })
  }
  return out
}

export async function install(settings: Settings, name: McpStatus['name'], agent: AgentKind): Promise<string> {
  const url = MCP_SERVERS[name]
  if (agent === 'claude') {
    await run(settings.claudePath || 'claude', ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, url], {
      timeoutMs: 30_000
    })
    return `Added ${name} to Claude Code. Authenticate once by running \`claude\` in a terminal and typing /mcp.`
  }
  await run(settings.codexPath || 'codex', ['mcp', 'add', name, '--url', url], { timeoutMs: 30_000 })
  return `Added ${name} to Codex. Run \`codex mcp login ${name}\` in a terminal to authenticate.`
}

export function triagePrompt(envName: string, appHint: string): string {
  return [
    `Use the Nightwatch MCP tools to look at the open issues (exceptions and performance issues) for the ${envName} environment of ${appHint}.`,
    'List the most important ones with occurrence counts, pick the most impactful one, read its stack trace and code context, find the root cause in this codebase, and fix it with a regression test.',
    'Summarise what you found and what you changed.'
  ].join(' ')
}
