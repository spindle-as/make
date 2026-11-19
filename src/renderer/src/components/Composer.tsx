import clsx from 'clsx'
import { ArrowUp, Blocks, Brain, ChevronDown, Cpu, Shield, Square, Target } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CommandMenu, HarnessDetails, useHarness, useMenuItems } from './HarnessMenus'
import type { AgentKind, ModelOption, PermissionMode } from '@shared/types'
import { shortcutFor } from '../lib/shortcuts'
import { useStore } from '../store'
import { Input, Kbd, OptionList, Popover, Segmented } from './ui'

export interface AgentConfig {
  agent: AgentKind
  model: string
  effort: string
  permissionMode: PermissionMode
  maxBudgetUsd?: number
}

export const PERMISSIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'plan', label: 'Plan only', description: 'Read-only. The agent investigates and proposes a plan.' },
  { value: 'default', label: 'Read-only', description: 'Reads freely; anything needing approval is refused.' },
  { value: 'acceptEdits', label: 'Auto-edit', description: 'Edits files freely; risky shell commands are refused.' },
  { value: 'auto', label: 'Auto', description: 'Approves its own actions after an automatic safety review.' },
  { value: 'bypassPermissions', label: 'Full access', description: 'No approvals at all. Use only in an isolated worktree.' }
]

function useModels(agent: AgentKind): ModelOption[] {
  const catalog = useStore((s) => s.models)
  return useMemo(() => (catalog ? catalog[agent] : []), [catalog, agent])
}

export function modelSummary(cfg: AgentConfig, models: ModelOption[]): { model: string; effort: string } {
  const known = models.find((x) => x.id === cfg.model)
  const m = known ?? models[0]
  const effortId = cfg.effort || m?.defaultEffort || ''
  const e = m?.efforts.find((x) => x.id === effortId)
  // A custom model id shows as itself, not as "Default".
  return { model: known ? known.label.replace(/ \(latest\)$/, '') : cfg.model || m?.label || 'Default', effort: cfg.effort ? (e?.label ?? cfg.effort) : e ? `${e.label} (default)` : 'Default' }
}

function ModelPicker({ cfg, onChange, onClose, open, locked, placement }: { cfg: AgentConfig; onChange: (p: Partial<AgentConfig>) => void; onClose: () => void; open: boolean; locked?: boolean; placement: 'top' | 'bottom' }) {
  const models = useModels(cfg.agent)
  const known = models.find((m) => m.id === cfg.model)
  // A custom id isn't in the list: offer every effort level and let the CLI decide.
  const selected = known ?? (cfg.model ? { ...(models.find((m) => m.efforts.length) ?? models[0]), id: cfg.model, label: cfg.model } : models[0])
  const efforts = selected?.efforts ?? []
  const [custom, setCustom] = useState(known || !cfg.model ? '' : cfg.model)
  const groups = [...new Set(models.map((m) => m.group ?? ''))]
  const pick = (model: string) => {
    const m = models.find((x) => x.id === model)
    // keep the chosen effort only if the new model supports it
    const keep = !m || m.efforts.some((e) => e.id === cfg.effort)
    onChange({ model, effort: keep ? cfg.effort : '' })
  }
  const effortOptions = [{ value: '', label: 'Default' }, ...efforts.map((e) => ({ value: e.id, label: e.label }))]
  const currentEffort = efforts.find((e) => e.id === (cfg.effort || selected?.defaultEffort))

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const i = effortOptions.findIndex((o) => o.value === cfg.effort)
      const n = effortOptions[(i + (e.key === 'ArrowRight' ? 1 : effortOptions.length - 1)) % effortOptions.length]
      onChange({ effort: n.value })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <Popover open={open} onClose={onClose} className="w-[460px]" placement={placement}>
      <div onKeyDown={onKey} className="flex flex-col gap-3 p-1">
        <div className="flex items-center justify-between">
          <Segmented<AgentKind>
            value={cfg.agent}
            onChange={(agent) => !locked && onChange({ agent, model: '', effort: '' })}
            options={[
              { value: 'claude', label: 'Claude Code' },
              { value: 'codex', label: 'Codex' }
            ]}
          />
          {locked && <span className="text-xs text-faint">Switching agent starts a new session</span>}
        </div>

        <div>
          <div className="mb-1 px-1 text-xs font-semibold tracking-wider text-faint uppercase">Model</div>
          <div className="max-h-72 overflow-y-auto pr-1">
            {groups.map((g, gi) => (
              <div key={g || 'all'} className={gi > 0 ? 'mt-2' : ''}>
                {g && groups.length > 1 && <div className="px-2 pb-0.5 text-2xs font-medium text-faint">{g}</div>}
                <OptionList
                  autoFocus={gi === 0}
                  value={cfg.model}
                  onSelect={pick}
                  options={models
                    .filter((m) => (m.group ?? '') === g)
                    .map((m) => ({
                      value: m.id,
                      label: m.label,
                      description: m.description,
                      right: m.id && m.id !== m.label ? <span className="mt-0.5 font-mono text-2xs text-faint">{m.id}</span> : undefined
                    }))}
                />
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 px-1 text-xs text-muted">
            <span className="shrink-0">Custom model ID</span>
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  e.preventDefault()
                  pick(custom.trim())
                }
              }}
              onBlur={() => custom.trim() && custom.trim() !== cfg.model && pick(custom.trim())}
              placeholder={cfg.agent === 'claude' ? 'e.g. claude-opus-5-5' : 'e.g. gpt-5-codex'}
              className="h-7 font-mono text-xs"
              spellCheck={false}
            />
          </label>
          {models.length <= 1 && cfg.agent === 'codex' && (
            <div className="px-1 pt-1 text-xs text-faint">Run Codex once to download its model list.</div>
          )}
        </div>

        {efforts.length > 0 && (
          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold tracking-wider text-faint uppercase">Reasoning</div>
            <Segmented size="sm" value={cfg.effort} onChange={(effort) => onChange({ effort })} options={effortOptions} className="flex-wrap" />
            {currentEffort?.description && <div className="mt-1.5 px-1 text-xs text-muted">{currentEffort.description}</div>}
          </div>
        )}

        {cfg.agent === 'claude' && (
          <label className="flex items-center gap-2 px-1 text-sm text-muted">
            Spend limit per turn
            <span className="relative">
              <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">$</span>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={cfg.maxBudgetUsd ?? ''}
                onChange={(e) => onChange({ maxBudgetUsd: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="none"
                className="h-8 w-24 pl-5"
              />
            </span>
          </label>
        )}

        <div className="flex items-center gap-3 border-t border-line px-1 pt-2 text-2xs text-faint">
          <span className="flex items-center gap-1">
            <Kbd keys={['↑', '↓']} /> model
          </span>
          <span className="flex items-center gap-1">
            <Kbd keys={['←', '→']} /> reasoning
          </span>
          <span className="flex items-center gap-1">
            <Kbd keys={['↵']} /> done
          </span>
        </div>
      </div>
    </Popover>
  )
}

function Chip({ icon, children, onClick, active, title }: { icon: ReactNode; children: ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      type="button"
      data-popover-anchor
      title={title}
      onClick={onClick}
      className={clsx(
        'press no-drag flex h-7 max-w-[300px] items-center gap-1.5 rounded-md px-2 text-xs',
        active ? 'bg-hover text-fg' : 'text-faint hover:bg-hover hover:text-fg'
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </button>
  )
}

export function Composer({
  cfg,
  onChange,
  onSubmit,
  running = false,
  canQueue = false,
  onStop,
  placeholder,
  header,
  footerRight,
  recall,
  agentLocked,
  autoFocus = true,
  big,
  projectId
}: {
  cfg: AgentConfig
  onChange: (p: Partial<AgentConfig>) => void
  onSubmit: (text: string) => Promise<boolean | void> | boolean | void
  running?: boolean
  /** allow sending while running (joins the current turn) */
  canQueue?: boolean
  onStop?: () => void
  placeholder: string
  header?: ReactNode
  footerRight?: ReactNode
  /** last user message, for ↑ on an empty box */
  recall?: string
  agentLocked?: boolean
  autoFocus?: boolean
  big?: boolean
  /** project whose commands, skills and subagents the menus offer */
  projectId?: string | null
}) {
  const [text, setText] = useState('')
  const [permOpen, setPermOpen] = useState(false)
  const [harnessOpen, setHarnessOpen] = useState(false)
  const [goal, setGoal] = useState(false)
  const harness = useHarness(projectId, cfg.agent)
  const menu = useMenuItems(text, harness)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosedFor, setMenuClosedFor] = useState('')
  const menuOpen = menu.items.length > 0 && menuClosedFor !== text
  useEffect(() => setMenuIndex(0), [menu.token])
  const insertItem = (it: { insert: string }) => {
    setText(text.slice(0, text.length - menu.token.length) + it.insert)
    ref.current?.focus()
  }
  const modelOpen = useStore((s) => s.modelPickerOpen)
  const setModelOpen = useStore((s) => s.setModelPicker)
  const focusTick = useStore((s) => s.focusTick)
  const ref = useRef<HTMLTextAreaElement>(null)
  const models = useModels(cfg.agent)
  const summary = modelSummary(cfg, models)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, big ? 360 : 300) + 'px'
  }, [text, big])

  useEffect(() => {
    if (autoFocus && !modelOpen) ref.current?.focus()
  }, [focusTick, autoFocus, modelOpen])

  const send = async () => {
    const typed = text.trim()
    if (!typed || (running && !canQueue)) return
    // Goal mode sends Claude Code's native /goal: it keeps working until the goal is met.
    const prompt = goal && cfg.agent === 'claude' && !typed.startsWith('/') ? `/goal ${typed}` : typed
    setText('')
    const ok = await onSubmit(prompt)
    if (ok === false) setText(typed)
    else setGoal(false)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = menu.items.length
        setMenuIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        insertItem(menu.items[menuIndex] ?? menu.items[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuClosedFor(text)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    } else if (e.key === 'ArrowUp' && !text && recall && !e.altKey && !e.metaKey) {
      e.preventDefault()
      setText(recall)
    } else if (e.key === 'Escape') {
      ref.current?.blur()
    }
  }

  const perm = PERMISSIONS.find((p) => p.value === cfg.permissionMode) ?? PERMISSIONS[2]

  const sendButton = running ? (
    <button
      type="button"
      onClick={onStop}
      title={`Stop  ${shortcutFor('stop')?.join('')}`}
      aria-label="Stop agent"
      className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-fg text-bg hover:opacity-85"
    >
      <Square className="size-3 fill-current" />
    </button>
  ) : (
    <button
      type="button"
      onClick={send}
      disabled={!text.trim()}
      title="Send (↵)"
      aria-label="Send"
      className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-ink hover:bg-accent-strong disabled:bg-hover disabled:text-faint"
    >
      <ArrowUp className="size-4" strokeWidth={2.5} />
    </button>
  )

  return (
    <div className="relative">
      {menuOpen && menu.kind && (
        <div className={clsx('absolute right-0 left-0 z-30', big ? 'top-full mt-1' : 'bottom-full mb-2')}>
          <CommandMenu items={menu.items} active={menuIndex} onPick={insertItem} onHover={setMenuIndex} kind={menu.kind} />
        </div>
      )}
      <div
        className={clsx(
          'rounded-2xl border border-line-strong bg-panel shadow-[0_8px_30px_-12px_rgb(0_0_0/0.35)] transition-[border-color,box-shadow]',
          'focus-within:border-fg/25 focus-within:shadow-[0_8px_30px_-10px_rgb(0_0_0/0.45),0_0_0_4px_color-mix(in_oklab,var(--color-fg)_6%,transparent)]'
        )}
      >
        {header && <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">{header}</div>}
        <div className="flex items-end gap-2 py-2 pr-2 pl-4">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={big ? 3 : 1}
            placeholder={goal ? 'Describe the goal — Claude keeps working until it’s done and verified' : placeholder}
            aria-label="Message"
            style={{ outline: 'none' }}
            className={clsx(
              // the frame shows focus (focus-within), so the textarea itself stays ring-free
              'block min-w-0 flex-1 resize-none bg-transparent py-1.5 leading-relaxed outline-none placeholder:text-faint focus-visible:outline-none',
              big ? 'min-h-[88px] text-lg' : 'text-base'
            )}
          />
          {running && canQueue && text.trim() && (
            <button
              type="button"
              onClick={send}
              title="Add to the current turn (↵)"
              aria-label="Send"
              className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-ink hover:bg-accent-strong"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          )}
          {sendButton}
        </div>
      </div>
      {/* Model, reasoning and permissions: a quiet row under the box, out of the way. */}
      <div className="mt-1.5 flex items-center gap-0.5 px-1">
        <div className="relative">
          <Chip
            icon={cfg.agent === 'codex' ? <Cpu className="size-3.5" /> : <Brain className="size-3.5" />}
            active={modelOpen}
            onClick={() => setModelOpen(!modelOpen)}
            title={`Model & reasoning  ${shortcutFor('model-picker')?.join('')}`}
          >
            <span className={modelOpen ? 'text-fg' : 'text-muted'}>{cfg.agent === 'codex' ? 'Codex' : 'Claude'}</span>
            <span className="opacity-50"> · </span>
            {summary.model}
            <span className="opacity-50"> · </span>
            {summary.effort}
          </Chip>
          <ModelPicker cfg={cfg} onChange={onChange} open={modelOpen} onClose={() => setModelOpen(false)} locked={agentLocked} placement={big ? 'bottom' : 'top'} />
        </div>
        <div className="relative">
          <Chip icon={<Shield className="size-3.5" />} active={permOpen} onClick={() => setPermOpen(!permOpen)} title={perm.description}>
            {perm.label}
          </Chip>
          <Popover open={permOpen} onClose={() => setPermOpen(false)} className="w-[380px]" placement={big ? 'bottom' : 'top'}>
            <div className="mb-1 px-2 pt-1 text-xs font-semibold tracking-wider text-faint uppercase">Permissions</div>
            <OptionList
              autoFocus
              value={cfg.permissionMode}
              onSelect={(permissionMode) => {
                onChange({ permissionMode })
                setPermOpen(false)
                ref.current?.focus()
              }}
              options={PERMISSIONS.map((p) => ({ value: p.value, label: p.label, description: p.description }))}
            />
          </Popover>
        </div>
        {cfg.agent === 'claude' && (
          <button
            type="button"
            onClick={() => {
              setGoal(!goal)
              ref.current?.focus()
            }}
            title="Goal mode: sends your message as Claude Code’s /goal — it keeps working until the goal is met"
            aria-pressed={goal}
            className={clsx('press no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-xs', goal ? 'bg-info/15 text-info' : 'text-faint hover:bg-hover hover:text-fg')}
          >
            <Target className="size-3.5" /> Goal
          </button>
        )}
        {harness && (
          <div className="relative">
            <Chip icon={<Blocks className="size-3.5" />} active={harnessOpen} onClick={() => setHarnessOpen(!harnessOpen)} title="What the agent has loaded — commands, skills, subagents, MCP">
              {cfg.agent === 'claude' ? `${harness.skills} skills · ${harness.agents.length} agents${harness.mcpServers.length ? ` · ${harness.mcpServers.length} MCP` : ''}` : `${harness.commands.length} prompts`}
            </Chip>
            <Popover open={harnessOpen} onClose={() => setHarnessOpen(false)} className="w-[420px]" placement={big ? 'bottom' : 'top'}>
              <HarnessDetails harness={harness} />
            </Popover>
          </div>
        )}
        <div className="flex-1" />
        {footerRight}
        <span className="hidden shrink-0 text-2xs whitespace-nowrap text-faint 2xl:inline">/ commands · @ agents · ↵ send</span>
      </div>
    </div>
  )
}
