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

/** Claude Code accepts aliases that track the latest model of each family, or full model ids. */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: '', label: 'Default', description: 'Whatever Claude Code is configured to use', efforts: CLAUDE_EFFORTS },
  { id: 'fable', label: 'Fable', description: 'Most capable — long, complex engineering work', efforts: CLAUDE_EFFORTS },
  { id: 'opus', label: 'Opus', description: 'Frontier coding and reasoning', efforts: CLAUDE_EFFORTS },
  { id: 'sonnet', label: 'Sonnet', description: 'Fast and strong for most features', efforts: CLAUDE_EFFORTS },
  { id: 'haiku', label: 'Haiku', description: 'Quickest and cheapest, small tasks', efforts: CLAUDE_EFFORTS }
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
