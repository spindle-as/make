import clsx from 'clsx'
import { Brain, Keyboard, Monitor, Plug, Rocket, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { PermissionMode, Settings } from '@shared/types'
import { act, useStore, type SettingsTab } from '../store'
import { modelSummary, PERMISSIONS } from './Composer'
import { IntegrationsList } from './Integrations'
import { Button, Field, Input, Segmented, Select, Toggle } from './ui'

const TABS: { key: SettingsTab; label: string; icon: ReactNode }[] = [
  { key: 'general', label: 'General', icon: <SlidersHorizontal className="size-4" /> },
  { key: 'integrations', label: 'Integrations', icon: <Plug className="size-4" /> },
  { key: 'agents', label: 'Agents & models', icon: <Brain className="size-4" /> },
  { key: 'shipping', label: 'Worktrees & shipping', icon: <Rocket className="size-4" /> },
  { key: 'appearance', label: 'Appearance', icon: <Monitor className="size-4" /> }
]

export function SettingsDialog({ onClose, initialTab }: { onClose: () => void; initialTab?: SettingsTab }) {
  const stored = useStore((s) => s.settings)!
  const models = useStore((s) => s.models)
  const update = useStore((s) => s.update)
  const setSettings = useStore((s) => s.setSettings)
  const openModal = useStore((s) => s.openModal)
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general')
  const [s, setS] = useState<Settings>(stored)
  const dirty = JSON.stringify(s) !== JSON.stringify(stored)

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })

  const save = async () => {
    const next = await act(() => window.api.saveSettings(s), 'Settings saved')
    if (next) setSettings(next)
  }

  const modelSelect = (agent: 'claude' | 'codex') => {
    const list = models?.[agent] ?? []
    const model = agent === 'claude' ? s.claudeModel : s.codexModel
    const effort = agent === 'claude' ? s.claudeEffort : s.codexEffort
    const m = list.find((x) => x.id === model) ?? list[0]
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised/40 p-4">
        <div className="text-base font-medium">{agent === 'claude' ? 'Claude Code' : 'Codex'}</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default model">
            <Select value={model} onChange={(e) => set(agent === 'claude' ? 'claudeModel' : 'codexModel', e.target.value)}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default reasoning">
            <Select value={effort} onChange={(e) => set(agent === 'claude' ? 'claudeEffort' : 'codexEffort', e.target.value)}>
              <option value="">Default{m?.defaultEffort ? ` (${m.defaultEffort})` : ''}</option>
              {(m?.efforts ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="text-xs text-faint">
          New threads start with {modelSummary({ agent, model, effort, permissionMode: 'default' }, list).model}. Change it per thread from the model menu (⌘⇧M).
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div
        role="dialog"
        aria-label="Settings"
        className="pop-in flex h-[min(760px,88vh)] w-[min(980px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="flex w-60 shrink-0 flex-col gap-1 border-r border-line bg-bg/40 p-3" aria-label="Settings sections">
          <div className="px-2 pt-1 pb-3 text-lg font-semibold">Settings</div>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              autoFocus={t.key === tab}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={clsx('flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm', tab === t.key ? 'bg-active text-fg' : 'text-muted hover:bg-raised hover:text-fg')}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <button type="button" onClick={() => openModal({ kind: 'shortcuts' })} className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-fg">
            <Keyboard className="size-4" /> Keyboard shortcuts
          </button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            {tab === 'general' && (
              <section className="flex flex-col gap-6">
                <h2 className="text-xl font-semibold">General</h2>
                <Field label="Experience" hint="Creator mode hides branches, terminals and code; Developer mode shows everything. Both work on the same projects. (⇧⌘D)">
                  <Segmented
                    value={s.mode}
                    onChange={(v) => set('mode', v)}
                    options={[
                      { value: 'creator', label: 'Creator — describe, preview, submit' },
                      { value: 'developer', label: 'Developer — full control' }
                    ]}
                  />
                </Field>
                <Toggle
                  checked={s.restricted}
                  onChange={(v) => set('restricted', v)}
                  label="Contributor-only machine"
                  hint="Never merge or deploy from this computer, whatever the GitHub role. Production tokens can't be added. The work always ends at “Submit for review”."
                />
                <Field label="Projects folder" hint="Where projects opened from GitHub or created new are stored.">
                  <Input value={s.projectsRoot} onChange={(e) => set('projectsRoot', e.target.value)} />
                </Field>
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-raised/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">Spindle Make {update?.current}</div>
                      <div className="text-xs text-faint">
                        {update?.status === 'available' || update?.status === 'ready' ? `Version ${update.latest} is available.` : 'New versions come from GitHub releases.'}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        useStore.getState().openModal({ kind: 'update' })
                        void window.api.checkForUpdates().catch(() => {})
                      }}
                    >
                      Check for updates
                    </Button>
                  </div>
                  <Toggle
                    checked={s.autoUpdate !== false}
                    onChange={(v) => set('autoUpdate', v)}
                    label="Download updates automatically"
                    hint="New versions download in the background. Installing always waits for you to click Restart."
                  />
                </div>
              </section>
            )}

            {tab === 'integrations' && (
              <section className="flex flex-col gap-4">
                <div>
                  <h2 className="text-xl font-semibold">Integrations</h2>
                  <p className="mt-1 text-sm text-muted">Everything is detected automatically. Missing pieces get one button — installs and sign-ins open in Terminal so you can follow along.</p>
                </div>
                <IntegrationsList />
              </section>
            )}

            {tab === 'agents' && (
              <section className="flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-semibold">Agents & models</h2>
                  <p className="mt-1 text-sm text-muted">Defaults for new threads. Each thread can change agent, model, reasoning and permissions on its own.</p>
                </div>
                {modelSelect('claude')}
                {modelSelect('codex')}
                <Field label="Default permissions for new features" hint="Chats always start read-only.">
                  <Select value={s.defaultPermissionMode} onChange={(e) => set('defaultPermissionMode', e.target.value as PermissionMode)}>
                    {PERMISSIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label} — {p.description}
                      </option>
                    ))}
                  </Select>
                </Field>
                <details className="rounded-xl border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium text-muted">Custom binary paths</summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Claude Code">
                      <Input value={s.claudePath} onChange={(e) => set('claudePath', e.target.value)} />
                    </Field>
                    <Field label="Codex">
                      <Input value={s.codexPath} onChange={(e) => set('codexPath', e.target.value)} />
                    </Field>
                  </div>
                </details>
              </section>
            )}

            {tab === 'shipping' && (
              <section className="flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-semibold">Worktrees & shipping</h2>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Worktree folder" hint="Each feature lives in <folder>/<project>/<feature>">
                    <Input value={s.worktreeRoot} onChange={(e) => set('worktreeRoot', e.target.value)} />
                  </Field>
                  <Field label="Branch prefix">
                    <Input value={s.branchPrefix} onChange={(e) => set('branchPrefix', e.target.value)} />
                  </Field>
                  <Field label="Merge method">
                    <Segmented
                      value={s.mergeMethod}
                      onChange={(v) => set('mergeMethod', v)}
                      options={[
                        { value: 'squash', label: 'Squash' },
                        { value: 'merge', label: 'Merge' },
                        { value: 'rebase', label: 'Rebase' }
                      ]}
                    />
                  </Field>
                  <Field label="Editor command" hint='e.g. phpstorm, code, cursor, or open -a "PhpStorm"'>
                    <Input value={s.editorCommand} onChange={(e) => set('editorCommand', e.target.value)} />
                  </Field>
                </div>
                <Toggle
                  checked={s.cleanupAfterShip}
                  onChange={(v) => set('cleanupAfterShip', v)}
                  label="Clean up automatically after shipping"
                  hint="Once a feature is merged (and deployed, when an environment auto-deploys), remove its worktree, Herd site, database and local branch. The conversation is kept."
                />
                <Toggle checked={s.deleteBranchOnMerge} onChange={(v) => set('deleteBranchOnMerge', v)} label="Delete the remote branch after merging" />
              </section>
            )}

            {tab === 'appearance' && (
              <section className="flex flex-col gap-5">
                <h2 className="text-xl font-semibold">Appearance</h2>
                <Field label="Text size" hint="Also ⌘+ / ⌘− / ⌘0 anywhere in the app.">
                  <Segmented
                    value={String(stored.uiScale ?? 1)}
                    onChange={(v) => void act(() => window.api.setZoom(Number(v)))}
                    options={[
                      { value: '0.9', label: 'Small' },
                      { value: '1', label: 'Default' },
                      { value: '1.1', label: 'Large' },
                      { value: '1.2', label: 'Larger' },
                      { value: '1.35', label: 'Huge' }
                    ]}
                  />
                </Field>
              </section>
            )}
          </div>
          {tab !== 'integrations' && tab !== 'appearance' && (
            <div className="flex items-center justify-end gap-2 border-t border-line px-8 py-3.5">
              {dirty && <span className="mr-auto text-sm text-faint">Unsaved changes</span>}
              <Button variant="ghost" onClick={() => setS(stored)} disabled={!dirty}>
                Revert
              </Button>
              <Button variant="primary" onClick={save} disabled={!dirty}>
                Save
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
