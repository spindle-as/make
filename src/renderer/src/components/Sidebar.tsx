import clsx from 'clsx'
import { Archive, ChevronRight, FolderPlus, GitBranch, Inbox, MessageSquare, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Settings, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Feature, FeatureStage } from '@shared/types'
import { shortcutFor } from '../lib/shortcuts'
import { isDone, orderedThreads, useStore } from '../store'
import { BrandIcon, Logo, PoweredBy } from './Brand'
import { ProjectDeployDot } from './DeployStatus'
import { useWords } from '../lib/words'
import { runAction } from '../lib/actions'
import { act } from '../store'
import { Segmented } from './ui'
import { UpdateNotice } from './Updates'
import { IconButton, Kbd, ResizeHandle, timeAgo } from './ui'

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
      return 'text-muted'
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

/** How many threads a project shows before "Show more". */
const PER_PROJECT = 8

const readFlag = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}
const writeFlag = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0')
  } catch {
    /* fine */
  }
}

/** One compact line per thread: state icon, title, and what needs attention on the right. */
function ThreadRow({ f, index, showProject }: { f: Feature; index: number; showProject?: boolean }) {
  const selected = useStore((s) => s.view === 'thread' && s.selectedFeatureId === f.id)
  const running = useStore((s) => s.statuses[f.id]?.running || f.setupStatus === 'running')
  const waiting = useStore((s) => s.requests[f.id]?.length ?? 0)
  const unseen = useStore((s) => !!s.unseen[f.id])
  const project = useStore((s) => (showProject ? s.projects.find((p) => p.id === f.projectId)?.name : undefined))
  const select = useStore((s) => s.select)
  const isChat = f.kind === 'chat'
  const state = waiting ? 'Needs you' : running ? 'Working…' : unseen ? 'Done — your turn' : isChat ? 'Chat' : f.cleanedUp ? 'Shipped' : STAGE_LABEL[f.stage]
  return (
    <button
      type="button"
      onClick={() => select(f.id)}
      aria-current={selected ? 'true' : undefined}
      title={`${f.title}\n${state} · ${timeAgo(f.updatedAt)}`}
      className={clsx(
        'press group relative flex h-10 w-full items-center gap-2.5 rounded-full pr-3 pl-3.5 text-left',
        selected ? 'bg-active font-medium text-fg' : unseen || waiting ? 'text-fg hover:bg-hover' : 'text-muted hover:bg-hover hover:text-fg'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {isChat ? <MessageSquare className="size-3.5 opacity-70" /> : <GitBranch className={clsx('size-3.5', stageTone(f.stage))} />}
      </span>
      <span className={clsx('min-w-0 flex-1 truncate text-sm', (unseen || waiting) && 'font-medium')}>
        {f.title}
        {project && <span className="ml-1.5 text-2xs text-faint">{project}</span>}
      </span>
      {waiting > 0 ? (
        <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warn px-1 text-2xs font-bold text-ink" aria-label={`${waiting} waiting`}>
          {waiting}
        </span>
      ) : running ? (
        <span className="pulse size-2 shrink-0 rounded-full bg-info" aria-label="Working" />
      ) : unseen ? (
        <span className="size-2 shrink-0 rounded-full bg-ok" aria-label="Finished — not seen yet" />
      ) : index >= 0 && index < 9 ? (
        <span className="hidden text-2xs text-faint tabular-nums group-hover:inline" aria-hidden>
          ⌘{index + 1}
        </span>
      ) : (
        <span className="hidden text-2xs text-faint group-hover:inline">{timeAgo(f.updatedAt)}</span>
      )}
    </button>
  )
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-1 px-3.5 text-xs font-medium text-muted">
      <span className="flex-1">{children}</span>
      {right}
    </div>
  )
}

/** The slim icon rail shown when the sidebar is collapsed. */
function Rail() {
  const startNew = useStore((s) => s.startNew)
  const openModal = useStore((s) => s.openModal)
  const toggle = useStore((s) => s.toggleSidebar)
  const attention = useStore((s) => new Set([...Object.keys(s.unseen), ...Object.entries(s.requests).filter(([, r]) => r.length).map(([id]) => id)]).size)
  const w = useWords()
  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel pb-3" aria-label="Threads (collapsed)">
      <div className="drag h-12 w-full shrink-0" />
      <IconButton title="Show sidebar" shortcut="toggle-sidebar" onClick={toggle}>
        <PanelLeftOpen className="size-4" />
      </IconButton>
      <div className="my-1 h-px w-6 bg-line" />
      <IconButton title={w.newFeature} shortcut="new-feature" onClick={() => startNew('feature')}>
        <Plus className="size-4" />
      </IconButton>
      <IconButton title="New chat" shortcut="new-chat" onClick={() => startNew('chat')}>
        <MessageSquarePlus className="size-4" />
      </IconButton>
      <IconButton title="Search & commands" shortcut="palette" onClick={() => openModal({ kind: 'palette' })}>
        <Search className="size-4" />
      </IconButton>
      {attention > 0 && (
        <button type="button" onClick={toggle} title={`${attention} thread${attention > 1 ? 's' : ''} waiting on you`} className="press relative mt-1 flex size-8 items-center justify-center rounded-lg text-fg hover:bg-hover">
          <Inbox className="size-4" />
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-bold text-ink">{attention}</span>
        </button>
      )}
      <div className="flex-1" />
      <IconButton title="Settings" shortcut="settings" onClick={() => openModal({ kind: 'settings' })}>
        <Settings2 className="size-4" />
      </IconButton>
      <BrandIcon size={22} />
    </aside>
  )
}

export function Sidebar() {
  const open = useStore((s) => s.sidebarOpen)
  if (!open) return <Rail />
  return <FullSidebar />
}

function FullSidebar() {
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const projects = useStore((s) => s.projects)
  const features = useStore((s) => s.features)
  const openModal = useStore((s) => s.openModal)
  const startNew = useStore((s) => s.startNew)
  const toggle = useStore((s) => s.toggleSidebar)
  const view = useStore((s) => s.view)
  const w = useWords()
  const mode = useStore((s) => s.settings?.mode ?? 'creator')
  const setSettings = useStore((s) => s.setSettings)
  const draftKind = useStore((s) => s.draft.kind)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [doneOpen, setDoneOpen] = useState(() => readFlag('sf.doneOpen', false))
  const [query, setQuery] = useState('')
  const order = useMemo(() => orderedThreads({ features, projects }), [features, projects])
  const indexOf = (f: Feature) => order.findIndex((x) => x.id === f.id)
  const q = query.trim().toLowerCase()
  const matches = (f: Feature) => !q || f.title.toLowerCase().includes(q) || f.branch.toLowerCase().includes(q) || (projects.find((p) => p.id === f.projectId)?.name.toLowerCase().includes(q) ?? false)
  const active = order.filter(matches)
  const done = useMemo(
    () => features.filter((f) => f.stage !== 'archived' && isDone(f)).sort((a, b) => b.updatedAt - a.updatedAt),
    [features]
  ).filter(matches)
  const general = active.filter((f) => !f.projectId)
  // The thread you're looking at is never hidden in a collapsed section.
  const selectedId = useStore((s) => (s.view === 'thread' ? s.selectedFeatureId : null))
  const showDone = doneOpen || !!q || done.some((f) => f.id === selectedId)

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-r border-line bg-panel" style={{ width: sidebarWidth }} aria-label="Threads">
      <ResizeHandle edge="right" label="Resize sidebar" value={sidebarWidth} min={220} max={440} fallback={272} onChange={setSidebarWidth} />
      <div className="drag flex h-12 shrink-0 items-center justify-end gap-0.5 pr-2 pl-20">
        <IconButton title="Open project" shortcut="add-project" onClick={() => void runAction('add-project')}>
          <FolderPlus className="size-4" />
        </IconButton>
        <IconButton title="Hide sidebar" shortcut="toggle-sidebar" onClick={toggle}>
          <PanelLeftClose className="size-4" />
        </IconButton>
      </div>

      <div className="px-4 pb-3">
        <Logo size={18} />
      </div>

      <div className="flex flex-col gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={() => startNew('feature')}
          className={clsx(
            'press flex h-12 items-center gap-3 rounded-2xl px-4 text-sm font-medium',
            view === 'new' && draftKind === 'feature' ? 'bg-active text-fg' : 'bg-hover text-fg hover:bg-active'
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
            'press flex h-10 items-center gap-3 rounded-full px-4 text-sm',
            view === 'new' && draftKind === 'chat' ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
          )}
        >
          <MessageSquarePlus className="size-4" />
          <span className="flex-1 text-left">New chat</span>
          <Kbd keys={shortcutFor('new-chat')} />
        </button>
        <label className="mt-1 flex h-10 items-center gap-2.5 rounded-full bg-hover/60 px-4 text-sm transition-colors focus-within:bg-hover focus-within:ring-3 focus-within:ring-focus">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search threads"
            aria-label="Search threads"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-faint hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {general.length > 0 && (
          <div className="mb-2">
            <SectionLabel>Chats</SectionLabel>
            <div className="flex flex-col gap-px">
              {general.map((f) => (
                <ThreadRow key={f.id} f={f} index={indexOf(f)} />
              ))}
            </div>
          </div>
        )}
        {projects.map((p) => {
          const list = active.filter((f) => f.projectId === p.id)
          if (q && list.length === 0) return null
          const isCollapsed = collapsed[p.id] && !q
          const shown = expanded[p.id] || q ? list : list.slice(0, PER_PROJECT)
          return (
            <div key={p.id} className="mb-2">
              <div className="group flex h-9 items-center gap-0.5 rounded-full pr-1 hover:bg-hover/60">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left"
                  onClick={() => setCollapsed({ ...collapsed, [p.id]: !isCollapsed })}
                >
                  <ChevronRight className={clsx('size-3.5 shrink-0 text-faint transition-transform', !isCollapsed && 'rotate-90')} />
                  <span className="truncate text-xs font-medium text-muted">{p.name}</span>
                  <ProjectDeployDot projectId={p.id} />
                </button>
                <IconButton title="Project settings" className="size-8 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => openModal({ kind: 'project', projectId: p.id })}>
                  <Settings className="size-3.5" />
                </IconButton>
                <IconButton title={`${w.newFeature} in ${p.name}`} className="size-8 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => startNew('feature', p.id)}>
                  <Plus className="size-3.5" />
                </IconButton>
              </div>
              {!isCollapsed && (
                <div className="mt-px flex flex-col gap-px">
                  {shown.map((f) => (
                    <ThreadRow key={f.id} f={f} index={indexOf(f)} />
                  ))}
                  {list.length > shown.length && (
                    <button type="button" onClick={() => setExpanded({ ...expanded, [p.id]: true })} className="press flex h-9 items-center gap-2 rounded-full pl-10 text-left text-xs text-muted hover:bg-hover hover:text-fg">
                      Show {list.length - shown.length} more
                    </button>
                  )}
                  {list.length === 0 && (
                    <button type="button" onClick={() => startNew('feature', p.id)} className="press flex h-9 items-center rounded-full pl-10 text-left text-xs text-muted hover:bg-hover hover:text-fg">
                      {w.newFeature}…
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {q && active.length === 0 && done.length === 0 && <div className="px-3 py-6 text-center text-sm text-faint">No threads match “{query}”.</div>}

        {done.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => {
                writeFlag('sf.doneOpen', !doneOpen)
                setDoneOpen(!doneOpen)
              }}
              className="press flex h-9 w-full items-center gap-1.5 rounded-full px-2.5 text-left hover:bg-hover/60"
            >
              <ChevronRight className={clsx('size-3.5 text-faint transition-transform', showDone && 'rotate-90')} />
              <Archive className="size-3.5 text-faint" />
              <span className="flex-1 text-xs font-medium text-muted">Done & older</span>
              <span className="rounded-full bg-hover px-1.5 text-2xs text-faint tabular-nums">{done.length}</span>
            </button>
            {showDone && (
              <div className="mt-px flex flex-col gap-px">
                {done.map((f) => (
                  <ThreadRow key={f.id} f={f} index={-1} showProject />
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-1.5 border-t border-line p-2">
        <UpdateNotice />
        <div className="flex items-center gap-1">
          <Segmented
            size="sm"
            className="flex-1 [&>button]:flex-1 [&>button]:justify-center"
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
          <IconButton title="Settings & integrations" shortcut="settings" onClick={() => openModal({ kind: 'settings' })}>
            <Settings2 className="size-4" />
          </IconButton>
        </div>
        <PoweredBy className="justify-center" />
      </div>
    </aside>
  )
}
