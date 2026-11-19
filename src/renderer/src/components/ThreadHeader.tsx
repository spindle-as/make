import clsx from 'clsx'
import { Archive, Check, Code2, ExternalLink, FolderOpen, MoreVertical, PanelRight, Pencil, Rocket, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Feature, FeatureStage, Project } from '@shared/types'
import { runAction } from '../lib/actions'
import { act, useStore } from '../store'
import { DeployPill } from './DeployStatus'
import { useIsCreator, useWords } from '../lib/words'
import { Button, IconButton, Menu, type MenuEntry } from './ui'

const STEPS: FeatureStage[] = ['coding', 'testing', 'pr', 'merged', 'deployed']

/**
 * Where the change stands, as one chip ("Step 2 of 5 · Preview"). It opens the review & ship
 * dialog — the next step lives there and under the conversation, not in a row of tabs.
 */
function StageChip({ feature }: { feature: Feature }) {
  const w = useWords()
  const running = useStore((s) => s.statuses[feature.id]?.running)
  const stage = feature.stage === 'setup' ? 'coding' : feature.stage
  const i = Math.max(0, STEPS.indexOf(stage))
  const label = w.stages[stage as keyof typeof w.stages] ?? stage
  const done = stage === 'deployed'
  return (
    <button
      type="button"
      onClick={() => useStore.getState().openModal({ kind: 'ship', featureId: feature.id })}
      title={`${STEPS.map((s) => w.stages[s as keyof typeof w.stages]).join(' → ')} — open review & ship`}
      className="press no-drag flex h-8 shrink-0 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm hover:bg-hover"
    >
      {done ? <Check className="size-4 text-ok" /> : running && i === 0 ? <span className="pulse size-2 rounded-full bg-info" /> : <span className="flex gap-0.5" aria-hidden>{STEPS.map((_, j) => <span key={j} className={clsx('h-1.5 w-1.5 rounded-full', j <= i ? 'bg-fg' : 'bg-line-strong')} />)}</span>}
      <span className="font-medium">{label}</span>
      <span className="sr-only">
        step {i + 1} of {STEPS.length}
      </span>
    </button>
  )
}

function Title({ feature, editSignal }: { feature: Feature; editSignal: number }) {
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (editSignal) setEditing(true)
  }, [editSignal])
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
    <button type="button" onClick={() => setEditing(true)} title="Rename" className="no-drag block max-w-full truncate rounded-md text-left text-base leading-tight font-semibold hover:text-fg">
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
  const w = useWords()
  const [renaming, setRenaming] = useState(0)
  // Material 3 top app bar: a few trailing actions, everything else in the overflow menu.
  const more: (MenuEntry | 'divider')[] = [
    { key: 'rename', label: 'Rename', icon: <Pencil className="size-4" />, onSelect: () => setRenaming((n) => n + 1) },
    ...(project && hasWorkspace && !creator
      ? [
          { key: 'editor', label: 'Open in editor', icon: <Code2 className="size-4" />, onSelect: () => void runAction('open-editor') },
          { key: 'terminal', label: 'Open in Terminal', icon: <SquareTerminal className="size-4" />, onSelect: () => void runAction('open-terminal') },
          { key: 'finder', label: 'Show in Finder', icon: <FolderOpen className="size-4" />, onSelect: () => void act(() => window.api.openInFinder(feature.worktreePath)) }
        ]
      : []),
    'divider',
    { key: 'archive', label: 'Archive…', icon: <Archive className="size-4" />, onSelect: () => void runAction('archive') }
  ]
  return (
    <header className={clsx('drag flex h-16 shrink-0 items-center gap-3 border-b border-line px-4', !sidebarOpen && 'pl-8')}>
      <div className="min-w-0 flex-1">
        <Title feature={feature} editSignal={renaming} />
        <div className="flex min-w-0 items-center gap-1.5 text-xs leading-tight whitespace-nowrap text-muted">
          <span className="shrink-0">{project?.name ?? 'General chat'}</span>
          {!isChat && !creator && (
            <>
              <span aria-hidden>·</span>
              <span className="selectable no-drag truncate font-mono">{feature.branch}</span>
            </>
          )}
        </div>
      </div>
      <div className="no-drag flex shrink-0 items-center gap-1">
        {project && <DeployPill project={project} feature={feature} />}
        {!isChat && !feature.cleanedUp && <StageChip feature={feature} />}
        {isChat && project && (
          <Button size="sm" variant="secondary" icon={<Rocket className="size-4" />} onClick={() => void runAction('promote')} shortcut="promote">
            {creator ? `Turn into a ${w.feature.toLowerCase()}` : 'Continue as feature'}
          </Button>
        )}
        {feature.localUrl && (
          <IconButton title="Open in your browser" shortcut="open-site" onClick={() => void runAction('open-site')}>
            <ExternalLink className="size-5" />
          </IconButton>
        )}
        {project && (
          <IconButton title={rightOpen ? 'Hide side panel' : 'Show side panel'} shortcut="toggle-panel" active={rightOpen} aria-pressed={rightOpen} onClick={() => void runAction('toggle-panel')}>
            <PanelRight className="size-5" />
          </IconButton>
        )}
        <Menu
          label="More actions"
          align="right"
          width={240}
          items={more}
          renderTrigger={(p) => (
            <IconButton {...p.props} title="More actions" onClick={p.toggle} active={p.open}>
              <MoreVertical className="size-5" />
            </IconButton>
          )}
        />
      </div>
    </header>
  )
}
