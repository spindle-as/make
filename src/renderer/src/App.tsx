import { useEffect } from 'react'
import { ArchiveDialog } from './components/ArchiveDialog'
import { Chat } from './components/Chat'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NewThread } from './components/NewThread'
import { OpenProjectDialog } from './components/OpenProject'
import { Onboarding } from './components/Onboarding'
import { ProjectDialog } from './components/ProjectDialog'
import { UpdateDialog } from './components/Updates'
import { RightPanel } from './components/RightPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { Sidebar } from './components/Sidebar'
import { ThreadHeader } from './components/ThreadHeader'
import { Toasts } from './components/Toasts'
import { runAction } from './lib/actions'
import { matchShortcut } from './lib/shortcuts'
import { useSelected, useStore } from './store'

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
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const view = useStore((s) => s.view)
  const onboarded = useStore((s) => s.settings?.onboarded ?? true)
  const rightTab = useStore((s) => s.rightTab)
  const { feature, project } = useSelected()

  useEffect(() => {
    void init()
  }, [init])
  useGlobalKeys()

  if (!ready) return <div className="drag h-full" />
  const close = () => openModal(null)

  if (!onboarded) {
    return (
      <div className="h-full">
        <Onboarding />
        {modal?.kind === 'project' && <ProjectDialog projectId={modal.projectId} tab={modal.tab} onClose={close} />}
        {modal?.kind === 'open-project' && <OpenProjectDialog onClose={close} />}
        <Toasts />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {sidebarOpen && <Sidebar />}
      <main className="flex min-w-0 flex-1">
        {view === 'thread' && feature ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <ThreadHeader feature={feature} project={project} />
              <ErrorBoundary label="Chat" resetKey={feature.id}>
                <Chat feature={feature} />
              </ErrorBoundary>
            </div>
            {rightOpen && project && (
              <ErrorBoundary label="Panel" resetKey={feature.id + rightTab}>
                <RightPanel feature={feature} project={project} />
              </ErrorBoundary>
            )}
          </>
        ) : (
          <NewThread />
        )}
      </main>
      {modal?.kind === 'settings' && <SettingsDialog onClose={close} initialTab={modal.tab} />}
      {modal?.kind === 'project' && <ProjectDialog projectId={modal.projectId} tab={modal.tab} onClose={close} />}
      {modal?.kind === 'archive' && <ArchiveDialog featureId={modal.featureId} onClose={close} />}
      {modal?.kind === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {modal?.kind === 'palette' && <CommandPalette onClose={close} />}
      {modal?.kind === 'open-project' && <OpenProjectDialog onClose={close} />}
      {modal?.kind === 'update' && <UpdateDialog onClose={close} />}
      <Toasts />
    </div>
  )
}
