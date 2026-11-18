import clsx from 'clsx'
import { ArrowUp, Brain, ChevronDown, Cpu, Shield, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  const m = models.find((x) => x.id === cfg.model) ?? models[0]
  const effortId = cfg.effort || m?.defaultEffort || ''
  const e = m?.efforts.find((x) => x.id === effortId)
  return { model: m?.label ?? (cfg.model || 'Default'), effort: cfg.effort ? (e?.label ?? cfg.effort) : e ? `${e.label} (default)` : 'Default' }
}

function ModelPicker({ cfg, onChange, onClose, open, locked, placement }: { cfg: AgentConfig; onChange: (p: Partial<AgentConfig>) => void; onClose: () => void; open: boolean; locked?: boolean; placement: 'top' | 'bottom' }) {
  const models = useModels(cfg.agent)
  const selected = models.find((m) => m.id === cfg.model) ?? models[0]
  const efforts = selected?.efforts ?? []
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
          <OptionList
            autoFocus
            className="max-h-56 overflow-y-auto"
            value={cfg.model}
            onSelect={(model) => {
              const m = models.find((x) => x.id === model)
              // keep the chosen effort only if the new model supports it
              const keep = m?.efforts.some((e) => e.id === cfg.effort)
              onChange({ model, effort: keep ? cfg.effort : '' })
            }}
            options={models.map((m) => ({
              value: m.id,
              label: m.label,
              description: m.description,
              right: m.id ? <span className="mt-0.5 font-mono text-2xs text-faint">{m.id}</span> : undefined
            }))}
          />
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
        'no-drag flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors',
        active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
      <ChevronDown className="size-3.5 shrink-0 opacity-60" />
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
  big
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
}) {
  const [text, setText] = useState('')
  const [permOpen, setPermOpen] = useState(false)
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
    const prompt = text.trim()
    if (!prompt || (running && !canQueue)) return
    setText('')
    const ok = await onSubmit(prompt)
    if (ok === false) setText(prompt)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className={clsx('rounded-2xl border bg-panel shadow-xl transition-colors', 'border-line-strong focus-within:border-accent/70')}>
      {header && <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">{header}</div>}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={big ? 3 : 1}
        placeholder={placeholder}
        aria-label="Message"
        style={{ outline: 'none' }}
        className={clsx(
          // the composer frame shows focus (focus-within), so the textarea itself stays ring-free
          'block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 leading-relaxed outline-none placeholder:text-faint focus-visible:outline-none',
          big ? 'min-h-[96px] text-lg' : 'text-base'
        )}
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <div className="relative">
          <Chip
            icon={cfg.agent === 'codex' ? <Cpu className="size-4" /> : <Brain className="size-4" />}
            active={modelOpen}
            onClick={() => setModelOpen(!modelOpen)}
            title={`Model & reasoning  ${shortcutFor('model-picker')?.join('')}`}
          >
            <span className="text-fg">{cfg.agent === 'codex' ? 'Codex' : 'Claude'}</span>
            <span className="text-faint"> · </span>
            {summary.model}
            <span className="text-faint"> · </span>
            {summary.effort}
          </Chip>
          <ModelPicker cfg={cfg} onChange={onChange} open={modelOpen} onClose={() => setModelOpen(false)} locked={agentLocked} placement={big ? 'bottom' : 'top'} />
        </div>
        <div className="relative">
          <Chip icon={<Shield className="size-4" />} active={permOpen} onClick={() => setPermOpen(!permOpen)} title={perm.description}>
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
        <div className="flex-1" />
        {footerRight}
        {running && canQueue && text.trim() && (
          <button
            type="button"
            onClick={send}
            title="Add to the current turn (↵)"
            aria-label="Send"
            className="mr-1 flex size-9 items-center justify-center rounded-xl bg-accent text-ink hover:bg-accent-strong"
          >
            <ArrowUp className="size-5" />
          </button>
        )}
        {running ? (
          <button
            type="button"
            onClick={onStop}
            title={`Stop  ${shortcutFor('stop')?.join('')}`}
            aria-label="Stop agent"
            className="flex size-9 items-center justify-center rounded-xl bg-fg text-bg hover:opacity-85"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!text.trim()}
            title="Send (↵)"
            aria-label="Send"
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-ink hover:bg-accent-strong disabled:opacity-30"
          >
            <ArrowUp className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}
