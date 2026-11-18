import clsx from 'clsx'
import { ChevronDown, ChevronRight, FolderPlus, GitBranch, MessageSquare, MessageSquarePlus, Plus, Search, Settings2, Settings } from 'lucide-react'
import { useState } from 'react'
import type { Feature, FeatureStage } from '@shared/types'
import { shortcutFor } from '../lib/shortcuts'
import { orderedThreads, useStore } from '../store'
import { Logo, PoweredBy } from './Brand'
import { ProjectDeployDot } from './DeployStatus'
import { useWords } from '../lib/words'
import { runAction } from '../lib/actions'
import { act } from '../store'
import { Segmented } from './ui'
import { UpdateNotice } from './Updates'
import { IconButton, Kbd, timeAgo } from './ui'

export const STAGE_LABEL: Record<FeatureStage, string> = {
  setup: 'Setting up',
  coding: 'Coding',
  testing: 'Ready to test',
  pr: 'In review',
  merged: 'Merged',
  deployed: 'Deployed',
  archived: 'Archived'
}

export function stageTone(stage: FeatureStage): string {
  switch (stage) {
    case 'coding':
      return 'text-accent-strong'
    case 'testing':
      return 'text-warn'
    case 'pr':
      return 'text-info'
    case 'merged':
    case 'deployed':
      return 'text-ok'
    default:
      return 'text-faint'
  }
}

function ThreadRow({ f, index }: { f: Feature; index: number }) {
  const selected = useStore((s) => s.view === 'thread' && s.selectedFeatureId === f.id)
  const running = useStore((s) => s.statuses[f.id]?.running)
  const waiting = useStore((s) => s.requests[f.id]?.length ?? 0)
  const select = useStore((s) => s.select)
  const isChat = f.kind === 'chat'
  return (
    <button
      type="button"
      onClick={() => select(f.id)}
      aria-current={selected ? 'true' : undefined}
      className={clsx(
        'group relative flex w-full items-center gap-2.5 rounded-lg py-2 pr-2 pl-3 text-left transition-colors',
        selected ? 'bg-active text-fg' : 'text-muted hover:bg-raised hover:text-fg'
      )}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {isChat ? <MessageSquare className="size-4 opacity-70" /> : <GitBranch className={clsx('size-4', stageTone(f.stage))} />}
        {(running || f.setupStatus === 'running') && <span className="pulse absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-panel" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-snug">{f.title}</span>
        <span className="flex items-center gap-1 text-xs text-faint">
          {waiting ? (
            <span className="font-medium text-warn">Needs you</span>
          ) : running ? (
            <span className="text-accent-strong">Working…</span>
          ) : isChat ? (
            <span>Chat</span>
          ) : (
            <span className={stageTone(f.stage)}>{f.cleanedUp ? 'Shipped' : STAGE_LABEL[f.stage]}</span>
          )}
          <span>·</span>
          <span className="truncate">{timeAgo(f.updatedAt)}</span>
        </span>
      </span>
      {waiting > 0 && (
        <span className="flex size-5 items-center justify-center rounded-full bg-warn text-2xs font-bold text-black" aria-label={`${waiting} waiting`}>
          {waiting}
        </span>
      )}
      {index < 9 && !waiting && (
        <span className="hidden text-2xs text-faint tabular-nums group-hover:inline" aria-hidden>
          ⌘{index + 1}
        </span>
      )}
    </button>
  )
}

export function Sidebar() {
  const projects = useStore((s) => s.projects)
  const features = useStore((s) => s.features)
  const openModal = useStore((s) => s.openModal)
  const startNew = useStore((s) => s.startNew)
  const view = useStore((s) => s.view)
  const w = useWords()
  const mode = useStore((s) => s.settings?.mode ?? 'creator')
  const setSettings = useStore((s) => s.setSettings)
  const draftKind = useStore((s) => s.draft.kind)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const order = orderedThreads({ features, projects })
  const indexOf = (f: Feature) => order.findIndex((x) => x.id === f.id)
  const general = order.filter((f) => !f.projectId)

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-panel" aria-label="Threads">
      <div className="drag flex h-12 items-center justify-end gap-0.5 pr-2 pl-20">
        <IconButton title="Search & commands" shortcut="palette" onClick={() => openModal({ kind: 'palette' })}>
          <Search className="size-4" />
        </IconButton>
        <IconButton title="Open project" shortcut="add-project" onClick={() => void runAction('add-project')}>
          <FolderPlus className="size-4" />
        </IconButton>
      </div>

      <div className="px-4 pt-1 pb-3">
        <Logo size={20} />
      </div>
      <div className="flex flex-col gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={() => startNew('feature')}
          className={clsx(
            'flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors',
            view === 'new' && draftKind === 'feature' ? 'bg-accent/15 text-accent-strong' : 'text-fg hover:bg-raised'
          )}
        >
          <Plus className="size-4" />
          <span className="flex-1 text-left">{w.newFeature}</span>
          <Kbd keys={shortcutFor('new-feature')} />
        </button>
        <button
          type="button"
          onClick={() => startNew('chat')}
          className={clsx(
            'flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors',
            view === 'new' && draftKind === 'chat' ? 'bg-accent/15 text-accent-strong' : 'text-muted hover:bg-raised hover:text-fg'
          )}
        >
          <MessageSquarePlus className="size-4" />
          <span className="flex-1 text-left">New chat</span>
          <Kbd keys={shortcutFor('new-chat')} />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {general.length > 0 && (
          <div className="mb-3">
            <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">Chats</div>
            <div className="flex flex-col gap-0.5">
              {general.map((f) => (
                <ThreadRow key={f.id} f={f} index={indexOf(f)} />
              ))}
            </div>
          </div>
        )}
        {projects.map((p) => {
          const list = order.filter((f) => f.projectId === p.id)
          const isCollapsed = collapsed[p.id]
          return (
            <div key={p.id} className="mb-3">
              <div className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-raised">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                  onClick={() => setCollapsed({ ...collapsed, [p.id]: !isCollapsed })}
                >
                  {isCollapsed ? <ChevronRight className="size-4 text-faint" /> : <ChevronDown className="size-4 text-faint" />}
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                  {list.length > 0 && <span className="text-xs text-faint">{list.length}</span>}
                  <ProjectDeployDot projectId={p.id} />
                </button>
                <IconButton title="Project settings" className="size-7 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => openModal({ kind: 'project', projectId: p.id })}>
                  <Settings className="size-3.5" />
                </IconButton>
                <IconButton title="New feature in this project" className="size-7 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => startNew('feature', p.id)}>
                  <Plus className="size-4" />
                </IconButton>
              </div>
              {!isCollapsed && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {list.map((f) => (
                    <ThreadRow key={f.id} f={f} index={indexOf(f)} />
                  ))}
                  {list.length === 0 && (
                    <button type="button" onClick={() => startNew('feature', p.id)} className="rounded-lg py-1.5 pl-9 text-left text-sm text-faint hover:text-muted">
                      Start a feature…
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="flex flex-col gap-2 border-t border-line p-2">
        <Segmented
          size="sm"
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
          value={mode}
          onChange={async (m) => {
            const next = await act(() => window.api.saveSettings({ mode: m }))
            if (next) setSettings(next)
          }}
          options={[
            { value: 'creator', label: 'Creator', title: 'Simple view — describe, preview, submit  ⇧⌘D' },
            { value: 'developer', label: 'Developer', title: 'Everything: code, branches, processes, deploys  ⇧⌘D' }
          ]}
        />
        <UpdateNotice />
        <button
          type="button"
          onClick={() => openModal({ kind: 'settings' })}
          className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-fg"
        >
          <Settings2 className="size-4" />
          <span className="flex-1 text-left">Settings & integrations</span>
          <Kbd keys={shortcutFor('settings')} />
        </button>
        <PoweredBy className="justify-center pb-1" />
      </div>
    </aside>
  )
}
