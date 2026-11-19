import clsx from 'clsx'
import { lazy, Suspense, useEffect } from 'react'
import { Chat } from './components/Chat'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NewThread } from './components/NewThread'
import { RightPanel } from './components/RightPanel'
import { Sidebar } from './components/Sidebar'
import { ThreadHeader } from './components/ThreadHeader'
import { Toasts } from './components/Toasts'
import { runAction } from './lib/actions'
import { matchShortcut } from './lib/shortcuts'
import { useSelected, useStore } from './store'

// Dialogs and onboarding load on first use: a smaller bundle opens faster.
const ArchiveDialog = lazy(() => import('./components/ArchiveDialog').then((m) => ({ default: m.ArchiveDialog })))
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const OpenProjectDialog = lazy(() => import('./components/OpenProject').then((m) => ({ default: m.OpenProjectDialog })))
const Onboarding = lazy(() => import('./components/Onboarding').then((m) => ({ default: m.Onboarding })))
const ProjectDialog = lazy(() => import('./components/ProjectDialog').then((m) => ({ default: m.ProjectDialog })))
const ShipDialog = lazy(() => import('./components/ShipDialog').then((m) => ({ default: m.ShipDialog })))
const UpdateDialog = lazy(() => import('./components/Updates').then((m) => ({ default: m.UpdateDialog })))
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })))
const ShortcutsDialog = lazy(() => import('./components/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })))

/** Light/dark from Settings → Appearance ("system" follows macOS through CSS). */
function useTheme() {
  const theme = useStore((s) => s.settings?.theme ?? 'system')
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
}

/** Dock badge = threads that need you (a question/approval, or finished while you were away). */
function useAttentionBadge() {
  const count = useStore((s) => {
    const ids = new Set<string>(Object.keys(s.unseen))
    for (const [id, r] of Object.entries(s.requests)) if (r.length) ids.add(id)
    return [...ids].filter((id) => s.features.some((f) => f.id === id)).length
  })
  useEffect(() => {
    void window.api.setBadge(count).catch(() => {})
  }, [count])
  // Coming back to the window counts as seeing the thread you're on.
  useEffect(() => {
    const onFocus = () => {
      const s = useStore.getState()
      if (s.view === 'thread' && s.selectedFeatureId && s.unseen[s.selectedFeatureId]) s.markSeen(s.selectedFeatureId)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

/** One keydown listener for the whole app; menu items route to the same actions. */
function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const m = matchShortcut(e)
      if (!m) return
      const { modal } = useStore.getState()
      // While a dialog is open only the palette/shortcut toggles and zoom work.
      if (modal && !['palette', 'shortcuts', 'zoom-in', 'zoom-out', 'zoom-reset'].includes(m.id)) return
      e.preventDefault()
      e.stopPropagation()
      void runAction(m.id, m.arg)
    }
    window.addEventListener('keydown', onKey)
    const off = window.menu.onAction((id) => void runAction(id))
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [])
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const modal = useStore((s) => s.modal)
  const openModal = useStore((s) => s.openModal)
  const rightOpen = useStore((s) => s.rightOpen)
  const view = useStore((s) => s.view)
  const onboarded = useStore((s) => s.settings?.onboarded ?? true)
  const { feature, project } = useSelected()

  useEffect(() => {
    void init()
  }, [init])
  useGlobalKeys()
  useAttentionBadge()
  useTheme()

  if (!ready) return <div className="drag h-full" />
  const close = () => openModal(null)

  if (!onboarded) {
    return (
      <div className="h-full">
        <Suspense fallback={null}>
          <Onboarding />
          {modal?.kind === 'project' && <ProjectDialog projectId={modal.projectId} tab={modal.tab} onClose={close} />}
          {modal?.kind === 'open-project' && <OpenProjectDialog onClose={close} />}
        </Suspense>
        <Toasts />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1">
        {view === 'thread' && feature ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <ThreadHeader feature={feature} project={project} />
              <ErrorBoundary label="Chat" resetKey={feature.id}>
                <Chat feature={feature} />
              </ErrorBoundary>
            </div>
            {/* Kept mounted while hidden, so the preview (logins, OTP flows, form state) survives closing the panel. */}
            {project && (
              <div className={clsx('flex', !rightOpen && 'pointer-events-none invisible w-0 overflow-hidden')} aria-hidden={!rightOpen}>
                <ErrorBoundary label="Panel" resetKey={feature.id}>
                  <RightPanel feature={feature} project={project} />
                </ErrorBoundary>
              </div>
            )}
          </>
        ) : (
          <NewThread />
        )}
      </main>
      <Suspense fallback={null}>
      {modal?.kind === 'settings' && <SettingsDialog onClose={close} initialTab={modal.tab} />}
      {modal?.kind === 'project' && <ProjectDialog projectId={modal.projectId} tab={modal.tab} onClose={close} />}
      {modal?.kind === 'archive' && <ArchiveDialog featureId={modal.featureId} onClose={close} />}
      {modal?.kind === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {modal?.kind === 'palette' && <CommandPalette onClose={close} />}
      {modal?.kind === 'open-project' && <OpenProjectDialog onClose={close} />}
      {modal?.kind === 'update' && <UpdateDialog onClose={close} />}
      {modal?.kind === 'ship' && <ShipDialog featureId={modal.featureId} onClose={close} />}
      </Suspense>
      <Toasts />
    </div>
  )
}
