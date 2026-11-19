import clsx from 'clsx'
import { ArrowUp, ChevronDown, Settings2, ShieldAlert, Square, Target, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CommandMenu, HarnessDetails, useHarness, useMenuItems, type MenuItem } from './HarnessMenus'
import type { AgentKind, HarnessView, ModelOption, PermissionMode } from '@shared/types'
import { shortcutFor } from '../lib/shortcuts'
import { useStore } from '../store'
import { Input, OptionList, Popover, Segmented, Select, Toggle } from './ui'

export interface AgentConfig {
  agent: AgentKind
  model: string
  effort: string
  permissionMode: PermissionMode
  maxBudgetUsd?: number
}

export const PERMISSIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'plan', label: 'Plan only', description: 'Looks around and proposes a plan; changes nothing until you approve.' },
  { value: 'default', label: 'Read-only', description: 'Reads freely; anything that needs approval is refused.' },
  { value: 'acceptEdits', label: 'Edit files', description: 'Edits files freely; risky commands are refused. Recommended.' },
  { value: 'auto', label: 'Auto', description: 'Approves its own actions after an automatic safety check.' },
  { value: 'bypassPermissions', label: 'Full access', description: 'No approvals at all. Only for isolated copies.' }
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

/**
 * Everything about how the agent works, in one place: agent, model, reasoning, approvals, goal
 * mode, spend limit — and what it has loaded. Opened from the one settings chip in the message box.
 */
function AgentSettings({
  cfg,
  onChange,
  open,
  onClose,
  locked,
  placement,
  goal,
  setGoal,
  harness,
  costUsd
}: {
  cfg: AgentConfig
  onChange: (p: Partial<AgentConfig>) => void
  open: boolean
  onClose: () => void
  locked?: boolean
  placement: 'top' | 'bottom'
  goal: boolean
  setGoal: (v: boolean) => void
  harness: HarnessView | null
  costUsd?: number
}) {
  const models = useModels(cfg.agent)
  const known = models.find((m) => m.id === cfg.model)
  // A custom id isn't in the list: offer every effort level and let the CLI decide.
  const selected = known ?? (cfg.model ? { ...(models.find((m) => m.efforts.length) ?? models[0]), id: cfg.model, label: cfg.model } : models[0])
  const efforts = selected?.efforts ?? []
  const groups = [...new Set(models.map((m) => m.group ?? ''))]
  const main = groups[0] ?? ''
  const pickedElsewhere = !!cfg.model && !models.some((m) => (m.group ?? '') === main && m.id === cfg.model)
  const [more, setMore] = useState(pickedElsewhere)
  const [custom, setCustom] = useState(known || !cfg.model ? '' : cfg.model)
  const [details, setDetails] = useState(false)
  const pick = (model: string) => {
    const m = models.find((x) => x.id === model)
    // keep the chosen effort only if the new model supports it
    const keep = !m || m.efforts.some((e) => e.id === cfg.effort)
    onChange({ model, effort: keep ? cfg.effort : '' })
  }
  const effortOptions = [{ value: '', label: 'Default' }, ...efforts.map((e) => ({ value: e.id, label: e.label }))]
  const currentEffort = efforts.find((e) => e.id === (cfg.effort || selected?.defaultEffort))
  const perm = PERMISSIONS.find((p) => p.value === cfg.permissionMode) ?? PERMISSIONS[2]
  const option = (m: ModelOption) => ({ value: m.id, label: m.label, description: m.description })

  return (
    <Popover open={open} onClose={onClose} className="max-h-[min(640px,75vh)] w-[440px] overflow-y-auto p-4" placement={placement}>
      <div role="group" aria-label="Agent settings" className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Agent settings</h2>
          <Segmented<AgentKind>
            size="sm"
            value={cfg.agent}
            onChange={(agent) => !locked && onChange({ agent, model: '', effort: '' })}
            options={[
              { value: 'claude', label: 'Claude', title: locked ? 'Switching agent starts a new session' : undefined },
              { value: 'codex', label: 'Codex', title: locked ? 'Switching agent starts a new session' : undefined }
            ]}
          />
        </div>

        <section aria-labelledby="as-model">
          <h3 id="as-model" className="mb-1.5 text-sm font-medium text-muted">
            Model
          </h3>
          <OptionList autoFocus value={cfg.model} onSelect={pick} options={models.filter((m) => (m.group ?? '') === main).map(option)} />
          {(groups.length > 1 || cfg.agent === 'claude') && (
            <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="mt-1 flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-hover hover:text-fg">
              <ChevronDown className={clsx('size-4 transition-transform', more && 'rotate-180')} /> {more ? 'Fewer models' : 'More models'}
            </button>
          )}
          {more && (
            <div className="mt-1 flex flex-col gap-2">
              {groups.slice(1).map((g) => (
                <div key={g}>
                  {g && <div className="px-3 pb-0.5 text-xs text-muted">{g}</div>}
                  <OptionList value={cfg.model} onSelect={pick} options={models.filter((m) => (m.group ?? '') === g).map(option)} />
                </div>
              ))}
              <label className="flex flex-col gap-1 px-1 text-xs text-muted">
                Exact model ID
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
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </label>
            </div>
          )}
          {models.length <= 1 && cfg.agent === 'codex' && <p className="px-1 pt-1 text-xs text-muted">Run Codex once to download its model list.</p>}
        </section>

        {efforts.length > 0 && (
          <section aria-labelledby="as-effort">
            <h3 id="as-effort" className="mb-1.5 text-sm font-medium text-muted">
              Thinking effort
            </h3>
            <Segmented size="sm" value={cfg.effort} onChange={(effort) => onChange({ effort })} options={effortOptions} className="flex-wrap" />
            {currentEffort?.description && <p className="mt-1.5 text-xs text-muted">{currentEffort.description}</p>}
          </section>
        )}

        <section aria-labelledby="as-perm">
          <h3 id="as-perm" className="mb-1.5 text-sm font-medium text-muted">
            What it may do on its own
          </h3>
          <Select aria-labelledby="as-perm" value={cfg.permissionMode} onChange={(e) => onChange({ permissionMode: e.target.value as PermissionMode })} className="w-full">
            {PERMISSIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className={clsx('mt-1.5 text-xs', cfg.permissionMode === 'bypassPermissions' ? 'text-warn' : 'text-muted')}>{perm.description}</p>
        </section>

        {cfg.agent === 'claude' && (
          <section className="flex flex-col gap-3">
            <Toggle checked={goal} onChange={setGoal} label="Goal mode" hint="Your next message becomes a goal: Claude keeps working until it’s done and checked." />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Spend limit per message
                <span className="block text-xs text-muted">Stops the turn when it would cost more.</span>
              </span>
              <span className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={cfg.maxBudgetUsd ?? ''}
                  onChange={(e) => onChange({ maxBudgetUsd: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="none"
                  aria-label="Spend limit in dollars"
                  className="w-28 pl-6"
                />
              </span>
            </label>
          </section>
        )}

        {(harness || costUsd) && (
          <section className="rounded-2xl bg-hover/60 px-4 py-3 text-xs text-muted">
            {harness && (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {harness.agent === 'claude'
                    ? `${harness.skills} skills, ${harness.agents.length} subagents${harness.mcpServers.length ? `, ${harness.mcpServers.length} connected tool${harness.mcpServers.length > 1 ? 's' : ''}` : ''}. Type / for commands, @ for a subagent.`
                    : `${harness.commands.length} custom prompts. Type / to use one.`}
                </span>
                <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="shrink-0 rounded-full px-2 py-1 font-medium text-fg hover:bg-active">
                  {details ? 'Hide' : 'Details'}
                </button>
              </div>
            )}
            {details && harness && (
              <div className="mt-3">
                <HarnessDetails harness={harness} />
              </div>
            )}
            {!!costUsd && <div className={clsx(harness && 'mt-2')}>This thread has cost ${costUsd.toFixed(2)} so far.</div>}
          </section>
        )}
      </div>
    </Popover>
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
  recall,
  agentLocked,
  autoFocus = true,
  big,
  projectId,
  costUsd
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
  /** last user message, for ↑ on an empty box */
  recall?: string
  agentLocked?: boolean
  autoFocus?: boolean
  big?: boolean
  /** project whose commands, skills and subagents the menus offer */
  projectId?: string | null
  costUsd?: number
}) {
  const [text, setText] = useState('')
  const [goal, setGoal] = useState(false)
  const harness = useHarness(projectId, cfg.agent)
  const menu = useMenuItems(text, harness)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosedFor, setMenuClosedFor] = useState('')
  const menuOpen = !!menu.kind && menuClosedFor !== text
  const listId = useId()
  useEffect(() => setMenuIndex(0), [menu.token])
  const settingsOpen = useStore((s) => s.modelPickerOpen)
  const setSettingsOpen = useStore((s) => s.setModelPicker)
  const focusTick = useStore((s) => s.focusTick)
  const ref = useRef<HTMLTextAreaElement>(null)
  const models = useModels(cfg.agent)
  const summary = modelSummary(cfg, models)
  const max = big ? 360 : 300

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
    // Only show a scrollbar once the text is taller than the box can grow.
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [text, max])

  useEffect(() => {
    if (autoFocus && !settingsOpen) ref.current?.focus()
  }, [focusTick, autoFocus, settingsOpen])

  const send = async (override?: string) => {
    const typed = (override ?? text).trim()
    if (!typed || (running && !canQueue)) return
    // Goal mode sends Claude Code's native /goal: it keeps working until the goal is met.
    const prompt = goal && cfg.agent === 'claude' && !typed.startsWith('/') ? `/goal ${typed}` : typed
    setText('')
    const ok = await onSubmit(prompt)
    if (ok === false) setText(typed)
    else setGoal(false)
  }

  const pickItem = (it: MenuItem) => {
    if (it.runsAlone && !running) {
      void send(it.insert.trim())
      return
    }
    setText(text.slice(0, text.length - menu.token.length) + it.insert)
    ref.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      const n = menu.items.length
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
        e.preventDefault()
        setMenuIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') && n) {
        e.preventDefault()
        pickItem(menu.items[menuIndex] ?? menu.items[0])
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
  // Only approvals that differ from the safe default are worth a visible chip.
  const unusualPerm = cfg.permissionMode !== 'acceptEdits'
  const chipLabel = `${summary.model}${cfg.effort ? ` · ${summary.effort}` : ''}`

  return (
    <div className="relative">
      {menuOpen && menu.kind && (
        <div className={clsx('absolute right-0 left-0 z-30', big ? 'top-full mt-2' : 'bottom-full mb-2')}>
          <CommandMenu id={listId} items={menu.items} active={menuIndex} onPick={pickItem} onHover={setMenuIndex} kind={menu.kind} query={menu.query} loading={!harness} />
        </div>
      )}
      {header && <div className="mb-2 flex flex-wrap items-center gap-2">{header}</div>}
      <div className={clsx('rounded-[28px] border bg-raised transition-colors', 'border-line focus-within:border-line-strong')}>
        {goal && cfg.agent === 'claude' && (
          <div className="px-4 pt-3">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-info/15 pr-1 pl-2.5 text-sm font-medium text-info">
              <Target className="size-4" /> Goal
              <button type="button" onClick={() => setGoal(false)} aria-label="Turn off goal mode" className="flex size-6 items-center justify-center rounded-full hover:bg-info/20">
                <X className="size-3.5" />
              </button>
            </span>
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={big ? 3 : 1}
          placeholder={goal ? 'Describe the goal — Claude keeps going until it’s done' : placeholder}
          aria-label="Message"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listId : undefined}
          aria-activedescendant={menuOpen && menu.items.length ? `${listId}-${menuIndex}` : undefined}
          aria-describedby={`${listId}-hint`}
          className={clsx(
            'block w-full resize-none bg-transparent px-5 pt-4 pb-1 leading-relaxed outline-none placeholder:text-muted',
            big ? 'min-h-[96px] text-lg' : 'text-base'
          )}
        />
        <span id={`${listId}-hint`} className="sr-only">
          Enter sends. Shift+Enter adds a line. Type / for commands or @ for a subagent.
        </span>
        <div className="flex items-center gap-1 px-2 pb-2">
          <div className="relative min-w-0">
            <button
              type="button"
              data-popover-anchor
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
              title={`Agent settings  ${shortcutFor('model-picker')?.join('') ?? ''}`}
              className={clsx('press flex h-10 max-w-full items-center gap-2 rounded-full px-3 text-sm', settingsOpen ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
            >
              <Settings2 className="size-4 shrink-0" />
              <span className="truncate">{chipLabel}</span>
            </button>
            <AgentSettings
              cfg={cfg}
              onChange={onChange}
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              locked={agentLocked}
              placement={big ? 'bottom' : 'top'}
              goal={goal}
              setGoal={setGoal}
              harness={harness}
              costUsd={costUsd}
            />
          </div>
          {unusualPerm && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              data-popover-anchor
              title={perm.description}
              className={clsx(
                'press flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium',
                cfg.permissionMode === 'bypassPermissions' ? 'bg-warn/15 text-warn' : 'bg-hover text-fg'
              )}
            >
              <ShieldAlert className="size-3.5" /> {perm.label}
            </button>
          )}
          <div className="flex-1" />
          {running && canQueue && text.trim() && (
            <button
              type="button"
              onClick={() => void send()}
              title="Add to the current turn (↵)"
              aria-label="Add to the current turn"
              className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-hover text-fg hover:bg-active"
            >
              <ArrowUp className="size-5" strokeWidth={2.25} />
            </button>
          )}
          {running ? (
            <button
              type="button"
              onClick={onStop}
              title={`Stop  ${shortcutFor('stop')?.join('') ?? ''}`}
              aria-label="Stop"
              className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-ink hover:bg-accent-strong"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!text.trim()}
              title="Send (↵)"
              aria-label="Send"
              className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-ink hover:bg-accent-strong disabled:bg-hover disabled:text-muted"
            >
              <ArrowUp className="size-5" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
