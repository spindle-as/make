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
  source: string
  /** text that replaces the typed token */
  insert: string
}

/**
 * Items for the "/" (commands, skills) or "@" (subagents) menu, matching the token being typed
 * at the start of the message ("/" only at the very start, like Claude Code).
 */
export function useMenuItems(text: string, harness: HarnessView | null): { items: MenuItem[]; token: string; kind: '/' | '@' | null } {
  return useMemo(() => {
    if (!harness) return { items: [], token: '', kind: null }
    const slash = text.match(/^\/([\w:.-]*)$/)
    if (slash) {
      const q = slash[1].toLowerCase()
      const items = harness.commands
        .filter((c) => c.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!b.name.toLowerCase().startsWith(q)) - Number(!a.name.toLowerCase().startsWith(q)))
        .slice(0, 40)
        .map((c: HarnessCommand) => ({ key: `/${c.name}`, label: `/${c.name}`, description: c.description, source: c.source, insert: `/${c.name} ` }))
      return { items, token: slash[0], kind: '/' as const }
    }
    const at = text.match(/(^|\s)@([\w:.-]*)$/)
    if (at && harness.agents.length) {
      const q = at[2].toLowerCase()
      const items = harness.agents
        .filter((a) => a.name.toLowerCase().includes(q))
        .map((a) => ({ key: `@${a.name}`, label: `@${a.name}`, description: a.description ?? 'Subagent', source: a.source, insert: `Use the ${a.name} subagent to ` }))
      return { items, token: `@${at[2]}`, kind: '@' as const }
    }
    return { items: [], token: '', kind: null }
  }, [text, harness])
}

const SOURCE_ICON: Record<string, typeof Terminal> = { skill: Sparkles, plugin: Puzzle, 'codex prompt': Terminal }

export function CommandMenu({ items, active, onPick, onHover, kind }: { items: MenuItem[]; active: number; onPick: (i: MenuItem) => void; onHover: (i: number) => void; kind: '/' | '@' }) {
  if (!items.length) return null
  return (
    <div className="rise-in absolute right-0 bottom-full left-0 z-30 mb-2 max-h-80 overflow-y-auto rounded-xl border border-line-strong bg-panel p-1 shadow-2xl" role="listbox" aria-label={kind === '/' ? 'Commands' : 'Subagents'}>
      <div className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold tracking-wider text-faint uppercase">{kind === '/' ? 'Commands & skills' : 'Subagents'}</div>
      {items.map((it, i) => {
        const Icon = kind === '@' ? Bot : (SOURCE_ICON[it.source] ?? Terminal)
        return (
          <button
            key={it.key}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(it)
            }}
            ref={(el) => {
              if (i === active) el?.scrollIntoView({ block: 'nearest' })
            }}
            className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === active ? 'bg-hover' : 'hover:bg-hover/60')}
          >
            <Icon className="size-3.5 shrink-0 text-faint" />
            <span className="shrink-0 font-mono text-[13px] text-fg">{it.label}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{it.description}</span>
            <span className="shrink-0 text-2xs text-faint">{it.source}</span>
          </button>
        )
      })}
      <div className="px-2.5 pt-1 pb-1 text-2xs text-faint">↑↓ choose · ↵ or Tab insert · Esc close</div>
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
