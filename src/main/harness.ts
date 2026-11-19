import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentKind, HarnessCommand, HarnessInfo, HarnessView } from '@shared/types'

/**
 * What the coding agent can do in a project: slash commands, skills, subagents and MCP servers.
 *
 * The authoritative list comes from Claude Code itself (its init event, saved per project after
 * every run). Files on disk add descriptions and fill in before the first run:
 *   .claude/commands/*.md, ~/.claude/commands/*.md   custom slash commands
 *   .claude/agents/*.md, ~/.claude/agents/*.md       subagents
 *   .claude/skills/<name>/SKILL.md, ~/.claude/skills  skills (also invokable as /name)
 *   ~/.codex/prompts/*.md                            Codex custom prompts (Spindle expands them)
 */

/** Built-in Claude Code commands worth explaining in the menu. */
const BUILT_IN: Record<string, string> = {
  goal: 'Give Claude a goal — it keeps working until it’s done',
  'code-review': 'Look over the changes for bugs',
  'security-review': 'Look over the changes for security problems',
  simplify: 'Tidy up the changed code',
  verify: 'Check that the work actually works',
  compact: 'Free up memory by summarising the conversation so far',
  context: 'Show how much of Claude’s memory is used',
  recap: 'Summarise what happened so far',
  init: 'Write a CLAUDE.md that explains this project',
  review: 'Review a pull request',
  debug: 'Help track down a problem',
  batch: 'Do the same task across many items',
  mcp: 'Show connected tools (MCP servers)',
  usage: 'Show how much of your plan is used'
}
/**
 * Commands that don't belong in the menu: they only work in Claude Code's own terminal UI, the
 * app already has a control for them (model, reasoning, output style), they're confusing outside
 * a terminal (list-agents lists terminal sessions), or they're unexpectedly expensive (insights).
 */
const HIDDEN = new Set([
  'clear', 'color', 'config', 'doctor', 'focus', 'reload-plugins', 'reload-skills', 'rename', 'heapdump', 'import', 'extra-usage', 'usage-credits', 'fast', 'autocompact', 'design-consent', 'design-revoke', 'team-onboarding', 'workflow-launch-exec',
  'agents', 'model', 'effort', 'output-style', 'list-agents', 'insights', 'ultrareview', 'auto-mode-setup', 'cost', 'status', 'statusline', 'terminal-setup', 'vim', 'theme', 'login', 'logout', 'exit', 'resume', 'permissions', 'hooks', 'memory', 'ide', 'install-github-app', 'export', 'bug', 'feedback', 'release-notes', 'privacy-settings', 'upgrade', 'add-dir', 'plugin', 'plugins', 'skills', 'sandbox', 'keybindings', 'pr-comments', 'migrate-installer'
])

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}

/** `description:` from YAML front matter, or the first non-heading line. */
export function describe(md: string): string | undefined {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)
  const d = fm?.[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]
  if (d) return d.slice(0, 140)
  const body = (fm ? md.slice(fm[0].length) : md).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  return body?.slice(0, 140)
}

function mdFiles(dir: string): { name: string; description?: string }[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ name: basename(f, '.md'), description: describe(read(join(dir, f))) }))
  } catch {
    return []
  }
}

function skillDirs(dir: string): { name: string; description?: string }[] {
  try {
    return readdirSync(dir)
      .filter((d) => existsSync(join(dir, d, 'SKILL.md')) && statSync(join(dir, d)).isDirectory())
      .map((d) => ({ name: d, description: describe(read(join(dir, d, 'SKILL.md'))) }))
  } catch {
    return []
  }
}

export function harnessView(agent: AgentKind, root: string | null, info: HarnessInfo | undefined, home = homedir()): HarnessView {
  if (agent === 'codex') {
    const prompts = mdFiles(join(home, '.codex', 'prompts')).map((p) => ({ ...p, source: 'codex prompt' }))
    return { agent, commands: prompts, agents: [], mcpServers: [], skills: 0, plugins: [], live: false }
  }
  const project = root ? mdFiles(join(root, '.claude', 'commands')).map((c) => ({ ...c, source: 'project' })) : []
  const user = mdFiles(join(home, '.claude', 'commands')).map((c) => ({ ...c, source: 'user' }))
  const skills = [...(root ? skillDirs(join(root, '.claude', 'skills')) : []), ...skillDirs(join(home, '.claude', 'skills'))].map((c) => ({ ...c, source: 'skill' }))
  const known = new Map<string, HarnessCommand>()
  for (const c of [...project, ...user, ...skills]) if (!known.has(c.name)) known.set(c.name, c)

  // Claude Code's own list wins: it includes plugin and built-in commands the disk can't show.
  const names = info?.slashCommands.length ? info.slashCommands : [...Object.keys(BUILT_IN), ...known.keys()]
  const skillSet = new Set(info?.skills ?? [])
  const commands: HarnessCommand[] = names
    .filter((n) => !HIDDEN.has(n))
    .map((n) => known.get(n) ?? { name: n, description: BUILT_IN[n], source: BUILT_IN[n] ? 'built-in' : skillSet.has(n) ? 'skill' : n.includes(':') ? 'plugin' : 'built-in' })
  // Most useful first: the ones we explain, then project/user, then the rest alphabetically.
  const rank = (c: HarnessCommand) => (c.name === 'goal' ? 0 : BUILT_IN[c.name] ? 1 : c.source === 'project' ? 2 : c.source === 'user' ? 3 : 4)
  commands.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))

  const agentDocs = new Map<string, { description?: string; source: string }>()
  for (const a of [...(root ? mdFiles(join(root, '.claude', 'agents')).map((x) => ({ ...x, source: 'project' })) : []), ...mdFiles(join(home, '.claude', 'agents')).map((x) => ({ ...x, source: 'user' }))]) {
    if (!agentDocs.has(a.name)) agentDocs.set(a.name, a)
  }
  const agentNames = info?.agents.length ? info.agents : [...agentDocs.keys()]
  return {
    agent,
    commands,
    agents: agentNames.map((n) => ({ name: n, ...(agentDocs.get(n) ?? { source: 'built-in' }) })),
    mcpServers: info?.mcpServers ?? [],
    skills: info?.skills.length ?? skills.length,
    plugins: info?.plugins ?? [],
    model: info?.model,
    version: info?.version,
    outputStyle: info?.outputStyle,
    live: !!info
  }
}

/**
 * Codex doesn't expand custom prompts in `exec` mode: "/name args" becomes the prompt file's text
 * with $ARGUMENTS (and $1…$9) filled in. Anything else is returned unchanged.
 */
export function expandCodexPrompt(text: string, home = homedir()): string {
  const m = text.match(/^\/([\w.-]+)(?:\s+([\s\S]*))?$/)
  if (!m) return text
  const body = read(join(home, '.codex', 'prompts', `${m[1]}.md`))
  if (!body) return text
  const args = (m[2] ?? '').trim()
  const parts = args.split(/\s+/)
  const filled = body
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$([1-9])/g, (_, i) => parts[Number(i) - 1] ?? '')
  return filled.trim()
}
