import clsx from 'clsx'
import { Database, FileDiff, Globe, Mail, Rocket, ScrollText, SquareTerminal, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Feature, Project } from '@shared/types'
import { ChangesPanel } from '../panels/ChangesPanel'
import { DataPanel } from '../panels/DataPanel'
import { MailPanel } from '../panels/MailPanel'
import { ReviewPanel } from '../panels/ReviewPanel'
import { useIsCreator, useWords, type Words } from '../lib/words'
import { LogsPanel } from '../panels/LogsPanel'
import { PreviewPanel } from '../panels/PreviewPanel'
import { SetupPanel } from '../panels/SetupPanel'
import { ShipPanel } from '../panels/ShipPanel'
import { TerminalPanel } from '../panels/TerminalPanel'
import { useStore, type RightTab } from '../store'

type TabDef = { key: RightTab; label: (w: Words) => string; icon: ReactNode }
const TABS: TabDef[] = [
  { key: 'preview', label: () => 'Preview', icon: <Globe className="size-4" /> },
  { key: 'changes', label: (w) => w.changesTab, icon: <FileDiff className="size-4" /> },
  { key: 'ship', label: (w) => w.shipTab, icon: <Rocket className="size-4" /> },
  { key: 'email', label: () => 'Email', icon: <Mail className="size-4" /> },
  { key: 'data', label: () => 'Data', icon: <Database className="size-4" /> },
  { key: 'logs', label: (w) => w.logsTab, icon: <ScrollText className="size-4" /> },
  { key: 'terminal', label: (w) => w.processesTab, icon: <SquareTerminal className="size-4" /> },
  { key: 'setup', label: (w) => w.setupTab, icon: <Wrench className="size-4" /> }
]

function tabsFor(feature: Feature, creator: boolean): RightTab[] {
  if (feature.kind === 'chat') return creator ? ['email', 'data'] : ['email', 'data', 'terminal', 'logs']
  if (feature.cleanedUp) return ['ship', 'logs']
  if (creator) return ['preview', 'changes', 'ship', 'email', 'data']
  const all: RightTab[] = ['preview', 'changes', 'ship', 'email', 'data', 'logs', 'terminal', 'setup']
  return feature.inPlace ? all.filter((t) => t !== 'setup') : all
}

const LS_WIDTH = 'sf.rightWidth'
/** How many threads keep a live preview while you look elsewhere. */
const KEEP_ALIVE = 4

export function RightPanel({ feature, project }: { feature: Feature; project: Project }) {
  const creator = useIsCreator()
  const w = useWords()
  const available = tabsFor(feature, creator)
  const stored = useStore((s) => s.rightTab)
  const tab = available.includes(stored) ? stored : available[0]
  const setTab = useStore((s) => s.setRightTab)
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
      <div className="no-scrollbar drag flex h-14 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2">
        {TABS.filter((t) => available.includes(t.key)).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            title={`${t.label(w)}  ⌘⌥${TABS.indexOf(t) + 1}`}
            className={clsx(
              'press no-drag flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm',
              tab === t.key ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
            )}
          >
            {t.icon}
            {t.label(w)}
            {t.key === 'setup' && feature.setupStatus === 'running' && <span className="pulse size-1.5 rounded-full bg-warn" />}
            {t.key === 'setup' && feature.setupStatus === 'failed' && <span className="size-1.5 rounded-full bg-bad" />}
          </button>
        ))}
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
        {tab === 'ship' && (creator ? <ReviewPanel feature={feature} project={project} /> : <ShipPanel feature={feature} project={project} />)}
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
