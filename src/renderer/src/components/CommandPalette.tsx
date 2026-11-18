import clsx from 'clsx'
import { Command, FolderGit2, GitBranch, MessageSquare, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { runAction } from '../lib/actions'
import { shortcutFor } from '../lib/shortcuts'
import { orderedThreads, useStore } from '../store'
import { Kbd } from './ui'

interface Item {
  id: string
  group: 'Threads' | 'Actions' | 'Projects'
  label: string
  hint?: string
  icon: ReactNode
  keys?: string[]
  run: () => void
}

function score(q: string, text: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.every((w) => t.includes(w))) return 0
  return t.startsWith(words[0]) ? 3 : 2
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const s = useStore()
  const feature = s.view === 'thread' ? s.features.find((f) => f.id === s.selectedFeatureId) : undefined

  useEffect(() => input.current?.focus(), [])

  const items = useMemo<Item[]>(() => {
    const act = (id: string, label: string, hint?: string): Item => ({
      id: `a:${id}`,
      group: 'Actions',
      label,
      hint,
      icon: <Command className="size-4" />,
      keys: shortcutFor(id),
      run: () => void runAction(id)
    })
    const actions: Item[] = [
      act('new-feature', 'New feature'),
      act('new-chat', 'New chat'),
      act('add-project', 'Add project…'),
      act('integrations', 'Set up integrations', 'Claude, Codex, GitHub, Ploi, DBngin…'),
      act('settings', 'Settings'),
      act('shortcuts', 'Keyboard shortcuts'),
      act('check-updates', 'Check for updates')
    ]
    if (feature) {
      actions.unshift(
        act('model-picker', 'Change model & reasoning', feature.model || 'default'),
        act('focus-composer', 'Focus message box'),
        ...(s.statuses[feature.id]?.running ? [act('stop', 'Stop agent')] : []),
        ...(feature.kind === 'chat' && feature.projectId ? [act('promote', 'Continue chat as feature')] : []),
        ...(feature.projectId ? [act('tab-changes', 'Show changes'), act('tab-terminal', 'Show terminal'), act('tab-logs', 'Show logs')] : []),
        ...(feature.kind === 'feature'
          ? [act('tab-preview', 'Show preview'), act('tab-ship', 'Ship: PR, CI, merge, deploy'), ...(feature.cleanedUp ? [] : [act('cleanup', 'Clean up workspace (worktree, site, database)')])]
          : []),
        ...(feature.localUrl ? [act('open-site', 'Open local site')] : []),
        ...(feature.projectId && !feature.cleanedUp ? [act('open-editor', 'Open in editor'), act('open-terminal', 'Open in Terminal')] : []),
        ...(feature.projectId ? [act('project-settings', 'Project settings')] : []),
        act('archive', 'Archive thread')
      )
    }
    actions.push(act('toggle-sidebar', 'Toggle sidebar'), act('toggle-panel', 'Toggle side panel'), act('zoom-in', 'Bigger text'), act('zoom-out', 'Smaller text'), act('zoom-reset', 'Reset text size'))

    const threads: Item[] = orderedThreads(s).map((f, i) => {
      const p = s.projects.find((x) => x.id === f.projectId)
      return {
        id: `t:${f.id}`,
        group: 'Threads',
        label: f.title,
        hint: `${p?.name ?? 'Chat'}${f.kind === 'feature' ? ` · ${f.branch}` : ''}`,
        icon: f.kind === 'chat' ? <MessageSquare className="size-4" /> : <GitBranch className="size-4" />,
        keys: i < 9 ? ['⌘', String(i + 1)] : undefined,
        run: () => s.select(f.id)
      }
    })
    const projects: Item[] = s.projects.map((p) => ({
      id: `p:${p.id}`,
      group: 'Projects',
      label: `New feature in ${p.name}`,
      hint: p.path,
      icon: <FolderGit2 className="size-4" />,
      run: () => s.startNew('feature', p.id)
    }))
    return [...threads, ...actions, ...projects]
  }, [s, feature])

  const filtered = useMemo(() => {
    const scored = items.map((it) => ({ it, sc: score(q, `${it.label} ${it.hint ?? ''}`) })).filter((x) => x.sc > 0)
    if (q) scored.sort((a, b) => b.sc - a.sc)
    const limitThreads = q ? 50 : 6
    let threadCount = 0
    return scored.map((x) => x.it).filter((it) => (it.group !== 'Threads' ? true : ++threadCount <= limitThreads))
  }, [items, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (it?: Item) => {
    if (!it) return
    onClose()
    setTimeout(it.run, 0)
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="pop-in w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(filtered[active])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="Search threads, projects and commands…"
            aria-label="Search"
            className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-faint"
          />
          <Kbd keys={['Esc']} />
        </div>
        <div ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-faint">No matches</div>}
          {filtered.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.id}>
                {header && <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-idx={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(it)}
                  className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', i === active ? 'bg-hover' : '')}
                >
                  <span className="text-muted">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-fg">{it.label}</span>
                    {it.hint && <span className="block truncate text-xs text-faint">{it.hint}</span>}
                  </span>
                  <Kbd keys={it.keys} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-faint">
          <span className="flex items-center gap-1.5">
            <Kbd keys={['↑', '↓']} /> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={['↵']} /> open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={shortcutFor('shortcuts')} /> all shortcuts
          </span>
        </div>
      </div>
    </div>
  )
}
