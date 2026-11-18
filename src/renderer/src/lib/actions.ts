import { act, orderedThreads, useStore, type RightTab } from '../store'

export async function addProject(): Promise<void> {
  const path = await window.api.pickDirectory()
  if (!path) return
  const p = await act(() => window.api.addProject({ path }), 'Project added')
  if (p) {
    const s = useStore.getState()
    s.upsertProject(p)
    s.setDraft({ projectId: p.id, kind: 'feature' })
    s.openModal({ kind: 'project', projectId: p.id })
  }
}

function current() {
  const s = useStore.getState()
  const feature = s.view === 'thread' ? s.features.find((f) => f.id === s.selectedFeatureId) : undefined
  const project = feature?.projectId ? s.projects.find((p) => p.id === feature.projectId) : undefined
  return { s, feature, project }
}

/** Every command — from the keyboard, the app menu or the palette — goes through here. */
export async function runAction(id: string, arg?: number): Promise<void> {
  const { s, feature } = current()
  switch (id) {
    case 'new-feature':
      return s.startNew('feature')
    case 'new-chat':
      return s.startNew('chat')
    case 'palette':
      return s.openModal(s.modal?.kind === 'palette' ? null : { kind: 'palette' })
    case 'settings':
      return s.openModal({ kind: 'settings' })
    case 'integrations':
      return s.openModal({ kind: 'settings', tab: 'integrations' })
    case 'shortcuts':
      return s.openModal({ kind: 'shortcuts' })
    case 'check-updates':
      s.openModal({ kind: 'update' })
      return void window.api.checkForUpdates().catch(() => {})
    case 'add-project':
      return s.openModal({ kind: 'open-project' })
    case 'toggle-mode': {
      const mode = s.settings?.mode === 'developer' ? 'creator' : 'developer'
      const next = await act(() => window.api.saveSettings({ mode }))
      if (next) {
        s.setSettings(next)
        s.toast('info', mode === 'creator' ? 'Creator mode — the simple view' : 'Developer mode — everything visible')
      }
      return
    }
    case 'project-settings': {
      const pid = feature?.projectId ?? s.draft.projectId
      if (pid) s.openModal({ kind: 'project', projectId: pid })
      return
    }
    case 'prev-thread':
    case 'next-thread': {
      const list = orderedThreads(s)
      if (!list.length) return
      const i = list.findIndex((f) => f.id === s.selectedFeatureId)
      const next = id === 'next-thread' ? (i < 0 ? 0 : Math.min(i + 1, list.length - 1)) : i < 0 ? list.length - 1 : Math.max(i - 1, 0)
      return s.select(list[next].id)
    }
    case 'goto-thread': {
      const f = orderedThreads(s)[(arg ?? 1) - 1]
      if (f) s.select(f.id)
      return
    }
    case 'archive':
      if (feature) s.openModal({ kind: 'archive', featureId: feature.id })
      return
    case 'promote':
      if (feature?.kind === 'chat' && feature.projectId) {
        const f = await act(() => window.api.promoteToFeature(feature.id), 'Started a feature from this chat')
        if (f) {
          await s.loadThread(f.id)
          s.select(f.id)
        }
      }
      return
    case 'cleanup':
      if (feature?.kind === 'feature' && confirm('Remove the worktree, Herd site and database for this feature? The conversation is kept.')) {
        await act(() => window.api.cleanupFeature(feature.id), 'Cleaned up')
      }
      return
    case 'focus-composer':
      return s.focusComposer()
    case 'model-picker':
      s.focusComposer()
      return s.setModelPicker(!s.modelPickerOpen)
    case 'stop':
      if (feature && s.statuses[feature.id]?.running) await act(() => window.api.stopAgent(feature.id))
      return
    case 'toggle-sidebar':
      return s.toggleSidebar()
    case 'toggle-panel':
      return s.toggleRight()
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset': {
      const cur = s.settings?.uiScale ?? 1
      const next = id === 'zoom-reset' ? 1 : cur + (id === 'zoom-in' ? 0.1 : -0.1)
      await act(() => window.api.setZoom(next))
      return
    }
    case 'open-editor':
      if (feature && !feature.cleanedUp) await act(() => window.api.openInEditor(feature.worktreePath))
      return
    case 'open-terminal':
      if (feature && !feature.cleanedUp) await act(() => window.api.openInTerminal(feature.worktreePath))
      return
    case 'open-site':
      if (feature?.localUrl) await window.api.openExternal(feature.localUrl)
      return
    default:
      if (id.startsWith('tab-') && feature) s.setRightTab(id.slice(4) as RightTab)
  }
}
