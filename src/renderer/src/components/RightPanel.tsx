import clsx from 'clsx'
import { ChevronDown, Database, FileDiff, Globe, Mail, ScrollText, SquareTerminal, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Feature, Project } from '@shared/types'
import { ChangesPanel } from '../panels/ChangesPanel'
import { DataPanel } from '../panels/DataPanel'
import { MailPanel } from '../panels/MailPanel'
import { useIsCreator, useWords, type Words } from '../lib/words'
import { LogsPanel } from '../panels/LogsPanel'
import { PreviewPanel } from '../panels/PreviewPanel'
import { SetupPanel } from '../panels/SetupPanel'
import { TerminalPanel } from '../panels/TerminalPanel'
import { useStore, type RightTab } from '../store'
import { IconButton, Menu } from './ui'

type ViewDef = { key: RightTab; label: (w: Words) => string; description: string; icon: ReactNode }
/** What the side panel can show. Review & ship is not here: it's a dialog of its own. */
const VIEWS: ViewDef[] = [
  { key: 'preview', label: () => 'Preview', description: 'Your copy of the app, to try the change', icon: <Globe className="size-4" /> },
  { key: 'changes', label: (w) => w.changesTab, description: 'The files the AI edited', icon: <FileDiff className="size-4" /> },
  { key: 'email', label: () => 'Emails', description: 'Emails your copy sent — they never reach anyone', icon: <Mail className="size-4" /> },
  { key: 'data', label: () => 'Data', description: 'Browse your copy’s database', icon: <Database className="size-4" /> },
  { key: 'logs', label: (w) => w.logsTab, description: 'Errors and log output', icon: <ScrollText className="size-4" /> },
  { key: 'terminal', label: (w) => w.processesTab, description: 'Dev server, queue and other processes', icon: <SquareTerminal className="size-4" /> },
  { key: 'setup', label: (w) => w.setupTab, description: 'How this copy was prepared', icon: <Wrench className="size-4" /> }
]

function viewsFor(feature: Feature, creator: boolean): RightTab[] {
  if (feature.kind === 'chat') return creator ? ['email', 'data'] : ['email', 'data', 'terminal', 'logs']
  if (feature.cleanedUp) return ['logs']
  if (creator) return ['preview', 'changes', 'email', 'data']
  const all: RightTab[] = ['preview', 'changes', 'email', 'data', 'logs', 'terminal', 'setup']
  return feature.inPlace ? all.filter((t) => t !== 'setup') : all
}

const LS_WIDTH = 'sf.rightWidth'
/** How many threads keep a live preview while you look elsewhere. */
const KEEP_ALIVE = 4

export function RightPanel({ feature, project }: { feature: Feature; project: Project }) {
  const creator = useIsCreator()
  const w = useWords()
  const available = viewsFor(feature, creator)
  const stored = useStore((s) => s.rightTab)
  const tab = available.includes(stored) ? stored : available[0]
  const setTab = useStore((s) => s.setRightTab)
  const current = VIEWS.find((v) => v.key === tab)
  const features = useStore((s) => s.features)
  const projects = useStore((s) => s.projects)
  // Threads whose preview has been opened (a few are kept alive). The list keeps a stable order:
  // reordering would move <webview> elements in the DOM, and a moved webview reloads its page.
  const [keep, setKeep] = useState<string[]>([])
  const lastUsed = useRef(new Map<string, number>())
  useEffect(() => {
    if (tab !== 'preview' || !available.includes('preview')) return
    lastUsed.current.set(feature.id, Date.now())
    setKeep((k) => {
      if (k.includes(feature.id)) return k
      let next = [...k, feature.id]
      while (next.length > KEEP_ALIVE) {
        // Drop the least recently used one (never the one being opened).
        const oldest = next.filter((x) => x !== feature.id).sort((a, b) => (lastUsed.current.get(a) ?? 0) - (lastUsed.current.get(b) ?? 0))[0]
        next = next.filter((x) => x !== oldest)
        lastUsed.current.delete(oldest)
      }
      return next
    })
  }, [tab, feature.id, available])
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(LS_WIDTH)) || 600
    } catch {
      return 600
    }
  })
  const dragging = useRef(false)
  const [viewport, setViewport] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Never let the panel squeeze the conversation: keep ~460px for chat next to the sidebar.
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const clamped = Math.max(360, Math.min(width, viewport - (sidebarOpen ? 280 : 0) - 460))

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    const w = Math.min(Math.max(window.innerWidth - e.clientX, 360), window.innerWidth - 740)
    setWidth(w)
  }, [])

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      try {
        localStorage.setItem(LS_WIDTH, String(width))
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', up)
    }
  }, [onMove, width])

  return (
    <div className="relative flex h-full shrink-0 flex-col border-l border-line bg-panel" style={{ width: clamped }}>
      <div
        className="absolute top-0 -left-1 z-20 h-full w-2 cursor-col-resize"
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
        }}
      />
      <div className="drag flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <Menu
          label="Show in the side panel"
          width={320}
          items={VIEWS.filter((v) => available.includes(v.key)).map((v) => ({
            key: v.key,
            label: v.label(w),
            description: v.description,
            icon: v.icon,
            checked: tab === v.key,
            trailing:
              v.key === 'setup' && feature.setupStatus === 'running' ? (
                <span className="pulse size-2 rounded-full bg-warn" aria-label="running" />
              ) : v.key === 'setup' && feature.setupStatus === 'failed' ? (
                <span className="size-2 rounded-full bg-bad" aria-label="failed" />
              ) : undefined,
            onSelect: () => setTab(v.key)
          }))}
          renderTrigger={(p) => (
            <button
              {...p.props}
              type="button"
              onClick={p.toggle}
              title="Choose what the side panel shows"
              className={clsx('press no-drag flex h-10 items-center gap-2 rounded-full pr-3 pl-4 text-sm font-medium', p.open ? 'bg-active' : 'hover:bg-hover')}
            >
              {current?.icon}
              {current?.label(w)}
              <ChevronDown className={clsx('size-4 text-muted transition-transform', p.open && 'rotate-180')} />
            </button>
          )}
        />
        {feature.setupStatus === 'failed' && tab !== 'setup' && available.includes('setup') && (
          <button type="button" onClick={() => setTab('setup')} className="no-drag rounded-full bg-bad/15 px-3 py-1 text-xs font-medium text-bad hover:bg-bad/25">
            Setup failed
          </button>
        )}
        <div className="flex-1" />
        <IconButton title="Close side panel" shortcut="toggle-panel" onClick={() => useStore.getState().toggleRight()}>
          <X className="size-5" />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Previews stay alive (hidden) when you switch tabs or threads: logins, OTP steps and forms keep their state. */}
        {keep.map((id) => {
          const f = features.find((x) => x.id === id)
          const p = f && projects.find((x) => x.id === f.projectId)
          if (!f || !p) return null
          const visible = id === feature.id && tab === 'preview'
          return (
            <div key={id} className={clsx('absolute inset-0', !visible && 'pointer-events-none invisible')} aria-hidden={!visible}>
              <PreviewPanel feature={f} project={p} active={visible} />
            </div>
          )
        })}
        {tab !== 'preview' && (
          <div className="absolute inset-0">
        {tab === 'changes' && <ChangesPanel feature={feature} />}
        {tab === 'email' && <MailPanel feature={feature} />}
        {tab === 'data' && <DataPanel feature={feature} />}
        {tab === 'logs' && <LogsPanel feature={feature} project={project} />}
        {tab === 'terminal' && <TerminalPanel feature={feature} project={project} />}
        {tab === 'setup' && <SetupPanel feature={feature} />}
          </div>
        )}
      </div>
    </div>
  )
}
