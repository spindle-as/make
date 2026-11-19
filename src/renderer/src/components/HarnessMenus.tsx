import clsx from 'clsx'
import { Bot, Plug, Puzzle, Sparkles, Terminal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentKind, HarnessCommand, HarnessView } from '@shared/types'

/** What the agent has loaded for a project — refreshed whenever Claude Code reports a new session. */
export function useHarness(projectId: string | null | undefined, agent: AgentKind): HarnessView | null {
  const [view, setView] = useState<HarnessView | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      void window.api
        .harness(projectId ?? null, agent)
        .then((v) => alive && setView(v))
        .catch(() => {})
    load()
    const off = window.api.on('harness:changed', (e) => {
      if (e.projectId === (projectId ?? '')) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId, agent])
  return view
}

export interface MenuItem {
  key: string
  label: string
  description?: string
  /** heading the item is listed under */
  group: string
  /** text that replaces the typed token */
  insert: string
  /** picking it sends right away (built-in commands that need nothing after them) */
  runsAlone?: boolean
}

/** Built-in commands that do their job without anything typed after them. */
const RUNS_ALONE = new Set(['compact', 'context', 'recap', 'mcp', 'usage', 'code-review', 'security-review', 'simplify', 'verify', 'init'])
const GROUPS: Record<string, string> = { 'built-in': 'Commands', skill: 'Skills', project: 'This project', user: 'Yours', plugin: 'Plugins', 'codex prompt': 'Prompts' }
const ORDER = ['Commands', 'This project', 'Yours', 'Skills', 'Plugins', 'Prompts']

/**
 * Items for the "/" (commands, skills) or "@" (subagents) menu, matching the token being typed
 * ("/" only at the very start, like Claude Code). Matches names and descriptions.
 */
export function useMenuItems(text: string, harness: HarnessView | null): { items: MenuItem[]; token: string; query: string; kind: '/' | '@' | null } {
  return useMemo(() => {
    const none = { items: [], token: '', query: '', kind: null }
    const slash = text.match(/^\/([\w:.-]*)$/)
    if (slash) {
      const q = slash[1].toLowerCase()
      const score = (c: HarnessCommand) => (c.name.toLowerCase().startsWith(q) ? 0 : c.name.toLowerCase().includes(q) ? 1 : 2)
      const items = (harness?.commands ?? [])
        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
        .map((c: HarnessCommand) => ({
          key: `/${c.name}`,
          label: `/${c.name}`,
          description: c.description,
          group: GROUPS[c.source] ?? 'Commands',
          insert: `/${c.name} `,
          runsAlone: c.source === 'built-in' && RUNS_ALONE.has(c.name),
          _s: score(c)
        }))
        .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a._s - b._s)
        .slice(0, 80)
        .map(({ _s: _, ...it }) => it)
      return { items, token: slash[0], query: slash[1], kind: '/' as const }
    }
    const at = text.match(/(^|\s)@([\w:.-]*)$/)
    if (at && harness?.agents.length) {
      const q = at[2].toLowerCase()
      const items = harness.agents
        .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q))
        .map((a) => ({ key: `@${a.name}`, label: `@${a.name}`, description: a.description ?? 'Subagent', group: 'Subagents', insert: `Use the ${a.name} subagent to ` }))
      return { items, token: `@${at[2]}`, query: at[2], kind: '@' as const }
    }
    return none
  }, [text, harness])
}

/**
 * The "/" and "@" suggestions: a Material 3 menu tied to the message box (ARIA combobox — the box
 * keeps focus, ↑/↓ move the highlighted option, ↵ or Tab picks, Esc closes).
 */
export function CommandMenu({
  id,
  items,
  active,
  onPick,
  onHover,
  kind,
  query,
  loading
}: {
  id: string
  items: MenuItem[]
  active: number
  onPick: (i: MenuItem) => void
  onHover: (i: number) => void
  kind: '/' | '@'
  query: string
  loading: boolean
}) {
  const Icon = kind === '@' ? Bot : Terminal
  return (
    <div className="menu-in overflow-hidden rounded-2xl border border-line bg-raised shadow-[0_12px_40px_-8px_rgb(0_0_0/0.5)]">
      <div id={id} role="listbox" aria-label={kind === '/' ? 'Commands' : 'Subagents'} className="max-h-80 overflow-y-auto py-2">
        {items.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted">
            {loading ? 'Loading commands…' : query ? `Nothing matches “${query}”.` : kind === '/' ? 'No commands available yet.' : 'No subagents yet.'}
          </div>
        )}
        {items.map((it, i) => (
          <div key={it.key}>
            {(i === 0 || items[i - 1].group !== it.group) && (
              <div role="presentation" className={clsx('px-4 pb-1 text-xs font-medium text-muted', i > 0 ? 'mt-2 pt-2' : 'pt-1')}>
                {it.group}
              </div>
            )}
            <div
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault() // keep focus in the message box
                onPick(it)
              }}
              ref={(el) => {
                if (i === active) el?.scrollIntoView({ block: 'nearest' })
              }}
              className={clsx('mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5', i === active ? 'bg-active' : 'hover:bg-hover')}
            >
              {it.group === 'Skills' ? <Sparkles className="size-4 shrink-0 text-muted" /> : it.group === 'Plugins' ? <Puzzle className="size-4 shrink-0 text-muted" /> : <Icon className="size-4 shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{it.label}</div>
                {it.description && <div className="truncate text-xs text-muted">{it.description}</div>}
              </div>
              {it.runsAlone && i === active && <span className="shrink-0 text-xs text-muted">↵ run</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-2 text-xs text-muted">↑↓ to choose · ↵ to pick · Esc to close</div>
    </div>
  )
}

/** What's loaded: model, subagents, skills, MCP servers (with status), plugins. */
export function HarnessDetails({ harness }: { harness: HarnessView }) {
  const bad = harness.mcpServers.filter((m) => m.status !== 'connected')
  return (
    <div className="flex flex-col gap-3 p-1 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{harness.agent === 'codex' ? 'Codex' : 'Claude Code'}</span>
        <span className="text-xs text-faint">{harness.live ? `${harness.version ? `v${harness.version} · ` : ''}${harness.model ?? ''}` : 'from files — refreshes after the first message'}</span>
      </div>
      {harness.agent === 'claude' && (
        <>
          <Row icon={<Bot className="size-3.5" />} label="Subagents" value={harness.agents.map((a) => a.name).join(', ') || '—'} hint="Type @ to hand work to one" />
          <Row icon={<Sparkles className="size-3.5" />} label="Skills" value={`${harness.skills}`} hint="Type / to run one" />
          <Row
            icon={<Plug className="size-3.5" />}
            label="MCP servers"
            value={harness.mcpServers.length ? harness.mcpServers.map((m) => `${m.name}${m.status === 'connected' ? '' : ` (${m.status})`}`).join(', ') : '—'}
            hint={bad.length ? `${bad.map((m) => m.name).join(', ')} need attention — run /mcp` : undefined}
            warn={bad.length > 0}
          />
          {harness.plugins.length > 0 && <Row icon={<Puzzle className="size-3.5" />} label="Plugins" value={harness.plugins.join(', ')} />}
          {harness.outputStyle && harness.outputStyle !== 'default' && <Row icon={<Terminal className="size-3.5" />} label="Output style" value={harness.outputStyle} />}
        </>
      )}
      <div className="rounded-lg bg-raised/60 px-2.5 py-2 text-xs text-muted">
        {harness.agent === 'claude'
          ? 'Everything Claude Code has works here: /goal keeps it going until done, /compact frees context, /code-review and /security-review check the work, and your skills, subagents and MCP servers load as usual.'
          : 'Codex custom prompts from ~/.codex/prompts work as /name — Spindle fills in $ARGUMENTS.'}
      </div>
    </div>
  )
}

function Row({ icon, label, value, hint, warn }: { icon: React.ReactNode; label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 text-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex gap-2 text-xs">
          <span className="w-24 shrink-0 text-faint">{label}</span>
          <span className="min-w-0 flex-1 text-fg/90">{value}</span>
        </div>
        {hint && <div className={clsx('ml-26 text-2xs', warn ? 'text-warn' : 'text-faint')}>{hint}</div>}
      </div>
    </div>
  )
}
