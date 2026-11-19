import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EffortOption, ModelCatalog, ModelOption } from '@shared/types'

const CLAUDE_EFFORTS: EffortOption[] = [
  { id: 'low', label: 'Low', description: 'Fastest, light reasoning' },
  { id: 'medium', label: 'Medium', description: 'Balanced for everyday tasks' },
  { id: 'high', label: 'High', description: 'Deeper reasoning for complex work' },
  { id: 'xhigh', label: 'Extra high', description: 'Extended reasoning for hard problems' },
  { id: 'max', label: 'Max', description: 'Maximum reasoning depth' }
]

/** Opus 4.6 / Sonnet 4.6 stop at "max" without "xhigh"; Haiku 4.5 takes no effort at all. */
const EFFORTS_NO_XHIGH = CLAUDE_EFFORTS.filter((e) => e.id !== 'xhigh')

/**
 * Claude Code takes family aliases (always the newest of that family) or exact model ids.
 * Exact ids pin a version — useful to keep a project on a model while a newer one is evaluated.
 */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: '', label: 'Default', description: 'Whatever Claude Code is configured to use', efforts: CLAUDE_EFFORTS, group: 'Latest' },
  { id: 'fable', label: 'Fable (latest)', description: 'Most capable — long, complex engineering work', efforts: CLAUDE_EFFORTS, group: 'Latest' },
  { id: 'opus', label: 'Opus (latest)', description: 'Frontier coding and reasoning', efforts: CLAUDE_EFFORTS, group: 'Latest' },
  { id: 'sonnet', label: 'Sonnet (latest)', description: 'Fast and strong for most work', efforts: CLAUDE_EFFORTS, group: 'Latest' },
  { id: 'haiku', label: 'Haiku (latest)', description: 'Quickest and cheapest, small tasks', efforts: CLAUDE_EFFORTS, group: 'Latest' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', efforts: EFFORTS_NO_XHIGH, group: 'Exact versions' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', efforts: EFFORTS_NO_XHIGH, group: 'Exact versions' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', efforts: CLAUDE_EFFORTS, group: 'Exact versions' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'No reasoning-effort setting', efforts: [], group: 'Exact versions' }
]

const GENERIC_CODEX_EFFORTS: EffortOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' }
]

const EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra'
}

interface CodexCacheModel {
  slug: string
  display_name?: string
  description?: string
  visibility?: string
  priority?: number
  default_reasoning_level?: string
  supported_reasoning_levels?: { effort: string; description?: string }[]
}

/** Parse ~/.codex/models_cache.json (written by the Codex CLI) into model options. */
export function parseCodexModels(json: string): ModelOption[] {
  const data = JSON.parse(json) as { models?: CodexCacheModel[] }
  return (data.models ?? [])
    .filter((m) => m.slug && m.visibility !== 'hide')
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      description: m.description,
      defaultEffort: m.default_reasoning_level,
      efforts: (m.supported_reasoning_levels ?? []).map((l) => ({
        id: l.effort,
        label: EFFORT_LABELS[l.effort] ?? l.effort,
        description: l.description
      }))
    }))
}

/** Read `model` / `model_reasoning_effort` from ~/.codex/config.toml (top-level keys only). */
export function parseCodexConfig(toml: string): { model?: string; effort?: string } {
  const out: { model?: string; effort?: string } = {}
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) break // stop at the first table
    const m = line.match(/^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"/)
    if (m) out[m[1] === 'model' ? 'model' : 'effort'] = m[2]
  }
  return out
}

export function catalog(): ModelCatalog {
  const codexDir = join(homedir(), '.codex')
  let codex: ModelOption[] = []
  try {
    const f = join(codexDir, 'models_cache.json')
    if (existsSync(f)) codex = parseCodexModels(readFileSync(f, 'utf8'))
  } catch {
    codex = []
  }
  let codexDefaults: { model?: string; effort?: string } = {}
  try {
    const f = join(codexDir, 'config.toml')
    if (existsSync(f)) codexDefaults = parseCodexConfig(readFileSync(f, 'utf8'))
  } catch {
    /* ignore */
  }
  const defaultCodex = codex.find((m) => m.id === codexDefaults.model)
  codex = [
    {
      id: '',
      label: 'Default',
      description: codexDefaults.model ? `Your Codex default (${defaultCodex?.label ?? codexDefaults.model})` : 'Whatever Codex is configured to use',
      efforts: defaultCodex?.efforts.length ? defaultCodex.efforts : GENERIC_CODEX_EFFORTS,
      defaultEffort: codexDefaults.effort
    },
    ...codex
  ]
  return {
    claude: CLAUDE_MODELS,
    codex,
    defaults: { claude: {}, codex: codexDefaults }
  }
}
