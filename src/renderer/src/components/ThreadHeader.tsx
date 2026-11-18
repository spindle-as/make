import clsx from 'clsx'
import { Archive, Check, Code2, ExternalLink, FolderOpen, GitBranch, MessageSquare, PanelLeft, PanelRight, Rocket, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Feature, FeatureStage, Project } from '@shared/types'
import { runAction } from '../lib/actions'
import { act, useStore, type RightTab } from '../store'
import { DeployPill } from './DeployStatus'
import { useIsCreator, useWords } from '../lib/words'
import { Button, IconButton } from './ui'

const PIPELINE: { key: FeatureStage; label: string; tab: RightTab }[] = [
  { key: 'coding', label: 'Code', tab: 'changes' },
  { key: 'testing', label: 'Test', tab: 'preview' },
  { key: 'pr', label: 'PR & CI', tab: 'ship' },
  { key: 'merged', label: 'Merge', tab: 'ship' },
  { key: 'deployed', label: 'Deploy', tab: 'ship' }
]
const ORDER: FeatureStage[] = ['setup', 'coding', 'testing', 'pr', 'merged', 'deployed']

function Pipeline({ feature }: { feature: Feature }) {
  const setTab = useStore((s) => s.setRightTab)
  const w = useWords()
  const running = useStore((s) => s.statuses[feature.id]?.running)
  const cur = ORDER.indexOf(feature.stage)
  return (
    <ol className="no-drag flex items-center gap-1" aria-label="Pipeline">
      {PIPELINE.map((step, i) => {
        const idx = ORDER.indexOf(step.key)
        const done = cur > idx
        const active = cur === idx || (step.key === 'coding' && feature.stage === 'setup')
        return (
          <li key={step.key} className="flex items-center gap-1">
            {i > 0 && <div className={clsx('h-px w-4', done || active ? 'bg-accent/60' : 'bg-line-strong')} />}
            <button
              type="button"
              onClick={() => setTab(step.tab)}
              aria-current={active ? 'step' : undefined}
              className={clsx(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                done && 'border-ok/30 bg-ok/10 text-ok',
                active && 'border-accent/50 bg-accent/15 text-accent-strong',
                !done && !active && 'border-line text-faint hover:text-muted'
              )}
            >
              {done ? (
                <Check className="size-3.5" />
              ) : active && running && step.key === 'coding' ? (
                <span className="pulse size-2 rounded-full bg-current" />
              ) : (
                <span className="tabular-nums">{i + 1}</span>
              )}
              {w.stages[step.key as keyof typeof w.stages] ?? step.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function NextStep({ feature }: { feature: Feature }) {
  const setTab = useStore((s) => s.setRightTab)
  const running = useStore((s) => s.statuses[feature.id]?.running)
  if (feature.cleanedUp) return <span className="text-sm text-faint">Shipped and cleaned up.</span>
  if (running) return <span className="truncate text-sm text-faint">The agent is working — switch to another thread meanwhile (⌥↓).</span>
  const hint = (text: string, label: string, tab: RightTab) => (
    <div className="flex min-w-0 items-center gap-2.5 text-sm text-faint">
      <span className="truncate">{text}</span>
      <button type="button" onClick={() => setTab(tab)} className="no-drag shrink-0 rounded-md bg-accent/15 px-2.5 py-1 text-sm font-medium text-accent-strong hover:bg-accent/25">
        {label} →
      </button>
    </div>
  )
  switch (feature.stage) {
    case 'setup':
      return hint('Setting up the workspace…', 'Setup log', 'setup')
    case 'coding':
      return hint('Describe what to build below.', 'Changes', 'changes')
    case 'testing':
      return feature.localUrl ? hint(`Test it at ${feature.localUrl.replace(/^https?:\/\//, '')}`, 'Preview', 'preview') : hint('Review the changes, then open a PR.', 'Ship', 'ship')
    case 'pr':
      return hint('Watch CI and merge when green.', 'Ship', 'ship')
    case 'merged':
      return hint('Merged — ready to deploy.', 'Deploy', 'ship')
    case 'deployed':
      return hint('Deployed. Keep an eye on production.', 'Logs', 'logs')
    default:
      return null
  }
}

function Title({ feature }: { feature: Feature }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(feature.title)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setValue(feature.title), [feature.title])
  useEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])
  const save = () => {
    setEditing(false)
    const t = value.trim()
    if (t && t !== feature.title) void act(() => window.api.updateFeature(feature.id, { title: t }))
    else setValue(feature.title)
  }
  if (editing)
    return (
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') {
            setValue(feature.title)
            setEditing(false)
          }
        }}
        className="no-drag w-full rounded-md bg-raised px-1.5 text-base font-semibold outline-none"
        aria-label="Thread title"
      />
    )
  return (
    <button type="button" onClick={() => setEditing(true)} title="Rename" className="no-drag block max-w-full truncate rounded-md text-left text-base leading-tight font-semibold hover:text-accent-strong">
      {feature.title}
    </button>
  )
}

export function ThreadHeader({ feature, project }: { feature: Feature; project: Project | null }) {
  const rightOpen = useStore((s) => s.rightOpen)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const isChat = feature.kind === 'chat'
  const hasWorkspace = !feature.cleanedUp
  const creator = useIsCreator()
  return (
    <>
      <header className={clsx('drag flex h-14 shrink-0 items-center gap-3 border-b border-line px-4', !sidebarOpen && 'pl-20')}>
        {!sidebarOpen && (
          <IconButton title="Show sidebar" shortcut="toggle-sidebar" onClick={() => void runAction('toggle-sidebar')}>
            <PanelLeft className="size-4" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1">
          <Title feature={feature} />
          <div className="flex min-w-0 items-center gap-1.5 text-xs leading-tight whitespace-nowrap text-faint">
            {isChat ? <MessageSquare className="size-3.5 shrink-0" /> : <GitBranch className="size-3.5 shrink-0" />}
            <span className="shrink-0">{project?.name ?? 'General chat'}</span>
            {!isChat && !creator && (
              <>
                <span>·</span>
                <span className="selectable no-drag truncate font-mono">{feature.branch}</span>
              </>
            )}
            {feature.localUrl && (
              <>
                <span>·</span>
                <button type="button" className="no-drag truncate text-info hover:underline" onClick={() => void window.api.openExternal(feature.localUrl!)}>
                  {feature.localUrl.replace(/^https?:\/\//, '')}
                </button>
              </>
            )}
            {feature.database && feature.database.driver !== 'sqlite' && !feature.cleanedUp && (
              <>
                <span>·</span>
                <span className="truncate">db {feature.database.name}</span>
              </>
            )}
          </div>
        </div>
        <div className="no-drag flex shrink-0 items-center gap-0.5">
          {isChat && project && (
            <Button size="sm" variant="secondary" icon={<Rocket className="size-4" />} onClick={() => void runAction('promote')} className="mr-1" shortcut="promote">
              Continue as feature
            </Button>
          )}
          {feature.localUrl && (
            <IconButton title="Open local site" shortcut="open-site" onClick={() => void runAction('open-site')}>
              <ExternalLink className="size-4" />
            </IconButton>
          )}
          {project && hasWorkspace && !creator && (
            <>
              <IconButton title="Open in editor" shortcut="open-editor" onClick={() => void runAction('open-editor')}>
                <Code2 className="size-4" />
              </IconButton>
              <IconButton title="Open in Terminal" shortcut="open-terminal" onClick={() => void runAction('open-terminal')}>
                <SquareTerminal className="size-4" />
              </IconButton>
              <IconButton title="Reveal in Finder" onClick={() => void act(() => window.api.openInFinder(feature.worktreePath))}>
                <FolderOpen className="size-4" />
              </IconButton>
            </>
          )}
          <IconButton title="Archive" shortcut="archive" onClick={() => void runAction('archive')}>
            <Archive className="size-4" />
          </IconButton>
          {project && (
            <IconButton title="Toggle side panel" shortcut="toggle-panel" active={rightOpen} onClick={() => void runAction('toggle-panel')}>
              <PanelRight className="size-4" />
            </IconButton>
          )}
        </div>
      </header>
      {!isChat && (
        <div className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-4">
          <Pipeline feature={feature} />
          <div className="min-w-0 flex-1">
            <NextStep feature={feature} />
          </div>
          {project && <DeployPill project={project} feature={feature} />}
        </div>
      )}
    </>
  )
}
