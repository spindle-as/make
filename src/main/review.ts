import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckResult, ChatItem, Feature, Project } from '@shared/types'
import { truncate } from '@shared/util'
import { exec } from './exec'
import { mergeBase } from './git'

export interface CheckDef {
  name: string
  command: string
}

/** The checks that make sense for this project, detected from its files. */
export function detectChecks(dir: string): CheckDef[] {
  const out: CheckDef[] = []
  const has = (p: string) => existsSync(join(dir, p))
  if (has('artisan') && (has('tests') || has('phpunit.xml') || has('phpunit.xml.dist'))) out.push({ name: 'Tests', command: 'php artisan test' })
  else if (has('vendor/bin/pest')) out.push({ name: 'Tests', command: 'vendor/bin/pest' })
  else if (has('vendor/bin/phpunit')) out.push({ name: 'Tests', command: 'vendor/bin/phpunit' })
  if (has('vendor/bin/pint')) out.push({ name: 'Code style', command: 'vendor/bin/pint --test' })
  if (has('vendor/bin/phpstan') && (has('phpstan.neon') || has('phpstan.neon.dist'))) out.push({ name: 'Static analysis', command: 'vendor/bin/phpstan analyse --no-progress --memory-limit=1G' })
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    const s = pkg.scripts ?? {}
    if (s.test && !/no test specified/.test(s.test) && !out.some((c) => c.name === 'Tests')) out.push({ name: 'Tests', command: 'npm test' })
    else if (s.test && !/no test specified/.test(s.test)) out.push({ name: 'Frontend tests', command: 'npm test' })
    if (s.lint) out.push({ name: 'Lint', command: 'npm run lint' })
    if (s.build) out.push({ name: 'Frontend build', command: 'npm run build' })
  } catch {
    /* no package.json */
  }
  return out
}

export interface ReviewFacts {
  files: { path: string; status: string }[]
  stat: string
  migrations: string[]
  commits: string[]
  diff: string
}

export async function gatherFacts(f: Feature): Promise<ReviewFacts> {
  const cwd = f.worktreePath
  const mb = await mergeBase(cwd, f.baseBranch)
  const [ns, stat, log, diff, untracked] = await Promise.all([
    exec('git', ['diff', '--name-status', '-M', mb], { cwd }),
    exec('git', ['diff', '--stat', mb], { cwd }),
    exec('git', ['log', '--format=%s', `${mb}..HEAD`], { cwd }),
    exec('git', ['diff', '-M', '--no-color', mb], { cwd, timeoutMs: 30_000 }),
    exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd })
  ])
  const files = ns.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const parts = l.split('\t')
      return { status: parts[0][0], path: parts[parts.length - 1] }
    })
  for (const u of untracked.stdout.split('\n').filter(Boolean)) if (!files.some((x) => x.path === u)) files.push({ status: 'A', path: u })
  return {
    files,
    stat: stat.stdout.trim().split('\n').pop() ?? '',
    migrations: files.filter((x) => x.status === 'A' && /database\/migrations\/.+\.php$/.test(x.path)).map((x) => x.path),
    commits: log.stdout.split('\n').filter(Boolean),
    diff: diff.stdout
  }
}

interface Narrative {
  title: string
  summary: string
  changes: string[]
  risks: string[]
  reviewerNotes: string[]
  database: string[]
}

/** Ask a model for the narrative parts only. Facts (tests, files, migrations) never come from the model. */
export async function writeNarrative(claude: string, f: Feature, project: Project, facts: ReviewFacts, thread: ChatItem[]): Promise<Narrative | null> {
  const lastSummary = [...thread].reverse().find((i) => i.role === 'assistant')?.text ?? ''
  const asks = thread.filter((i) => i.role === 'user').map((i) => `- ${truncate(i.text.replace(/\s+/g, ' '), 300)}`).slice(-12).join('\n')
  const prompt = `You are writing the narrative parts of a pull request description for engineers reviewing it.
Project: ${project.name}. Feature: "${f.title}".

What the requester asked for:
${asks || '(not available)'}

The agent's final summary:
${truncate(lastSummary, 3000)}

Changed files:
${facts.files.map((x) => `${x.status} ${x.path}`).join('\n')}

New migrations: ${facts.migrations.join(', ') || 'none'}

Diff (may be truncated):
${truncate(facts.diff, 50_000)}

Reply with ONLY a JSON object, no code fences:
{"title": "<imperative PR title, max 70 chars>",
 "summary": "<2-4 sentences: what was implemented and why>",
 "changes": ["<key modification, naming affected area>", ...max 8],
 "database": ["<one line per migration explaining the schema change>"],
 "risks": ["<concrete compatibility/breaking-change risk>", ...or []],
 "reviewerNotes": ["<what deserves special attention>", ...or []]}
Be accurate and concise. Do not mention tests or whether they passed. Do not use any tools.`
  const r = await exec(claude, ['-p', '--output-format', 'text', '--model', 'sonnet', '--effort', 'low'], { input: prompt, cwd: f.worktreePath, timeoutMs: 180_000 })
  if (r.code !== 0) return null
  const m = r.stdout.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Partial<Narrative>
    return {
      title: String(j.title ?? f.title).slice(0, 100),
      summary: String(j.summary ?? ''),
      changes: (j.changes ?? []).map(String),
      risks: (j.risks ?? []).map(String),
      reviewerNotes: (j.reviewerNotes ?? []).map(String),
      database: (j.database ?? []).map(String)
    }
  } catch {
    return null
  }
}

const seconds = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.max(1, Math.round(ms / 1000))}s`)

/** Compose the final PR body. The Testing section is built strictly from recorded check runs. */
export function composeBody(f: Feature, facts: ReviewFacts, n: Narrative | null, lastSummary: string): string {
  const out: string[] = []
  out.push('## Summary', '', n?.summary || truncate(lastSummary.trim(), 1500) || f.title, '')
  out.push('## Changes', '')
  if (n?.changes.length) out.push(...n.changes.map((c) => `- ${c}`))
  else out.push(...facts.files.slice(0, 25).map((x) => `- \`${x.path}\` (${x.status === 'A' ? 'added' : x.status === 'D' ? 'deleted' : 'modified'})`))
  const added = facts.files.filter((x) => x.status === 'A').length
  out.push('', `<sub>${facts.files.length} file${facts.files.length === 1 ? '' : 's'} changed${added ? ` (${added} new)` : ''}</sub>`, '')
  out.push('## Visual changes', '')
  if (f.visualNotes?.length) out.push(...f.visualNotes.map((v) => `- ${v}`), '', '_Requested by pointing at the running app in Spindle._')
  else out.push('_No visual change requests were made in the preview._')
  out.push('', '## Database changes', '')
  if (facts.migrations.length) {
    facts.migrations.forEach((m, i) => out.push(`- \`${m.split('/').pop()}\`${n?.database[i] ? ` — ${n.database[i]}` : ''}`))
  } else out.push('_No migrations._')
  out.push('', '## Testing', '')
  const checks = latestChecks(f.checks ?? [])
  if (!checks.length) out.push('⚠️ No checks were run in Spindle before submitting. Please run the test suite before merging.')
  else {
    out.push('| Check | Command | Result |', '|---|---|---|')
    for (const c of checks) out.push(`| ${c.name} | \`${c.command}\` | ${c.ok ? `✅ Passed (${seconds(c.durationMs)})` : `❌ Failed (exit ${c.code})`} |`)
    const stale = checks.some((c) => c.at < (f.updatedAt ?? 0) - 1000)
    if (checks.some((c) => !c.ok)) out.push('', '> Some checks failed — see the details above before merging.')
    if (stale) out.push('', '> Note: code may have changed after the last check run.')
  }
  out.push('', '## Risks', '')
  out.push(...(n?.risks.length ? n.risks.map((r) => `- ${r}`) : ['_None identified._']))
  if (n?.reviewerNotes.length) out.push('', '## Reviewer notes', '', ...n.reviewerNotes.map((r) => `- ${r}`))
  out.push('', '---', '<sub>Submitted with Spindle / Make · powered by jsj</sub>')
  return out.join('\n')
}

/** Most recent result per check name. */
export function latestChecks(all: CheckResult[]): CheckResult[] {
  const byName = new Map<string, CheckResult>()
  for (const c of [...all].sort((a, b) => a.at - b.at)) byName.set(c.name, c)
  return [...byName.values()]
}
