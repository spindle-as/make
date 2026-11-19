import { create } from 'zustand'
import type { AgentKind, AgentStatus, ChatItem, ChecksProgress, DeployState, Feature, IntegrationStatus, ModelCatalog, PendingRequest, PermissionMode, ProcessInfo, Project, Settings, ThreadKind, UpdateState } from '@shared/types'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

export type RightTab = 'changes' | 'preview' | 'ship' | 'logs' | 'terminal' | 'setup' | 'email' | 'data'
export type SettingsTab = 'general' | 'integrations' | 'agents' | 'shipping' | 'appearance'

export type Modal =
  | { kind: 'settings'; tab?: SettingsTab }
  | { kind: 'project'; projectId: string; tab?: 'general' | 'environment' | 'deploy' }
  | { kind: 'archive'; featureId: string }
  | { kind: 'shortcuts' }
  | { kind: 'palette' }
  | { kind: 'open-project' }
  | { kind: 'update' }
  /** the review & ship flow for a change: checks, submit, approve, go live */
  | { kind: 'ship'; featureId: string }
  | null

/** Settings for the next thread, chosen on the "new" screen before anything exists. */
export interface Draft {
  kind: ThreadKind
  projectId: string | null
  agent: AgentKind
  model: string
  effort: string
  permissionMode: PermissionMode
  baseBranch: string
}

interface State {
  ready: boolean
  projects: Project[]
  features: Feature[]
  settings: Settings | null
  models: ModelCatalog | null
  integrations: IntegrationStatus[] | null
  threads: Record<string, ChatItem[]>
  statuses: Record<string, AgentStatus>
  /** approvals/questions waiting on the user, per thread */
  requests: Record<string, PendingRequest[]>
  processes: Record<string, ProcessInfo>
  /** live output per process id (capped) */
  procOutput: Record<string, string>
  /** live deploy state per `${projectId}:${envId}` */
  deploys: Record<string, DeployState>
  /** bumps when new mail is captured */
  mailTick: number
  /** live "Check changes" runs per thread */
  checks: Record<string, ChecksProgress>
  view: 'thread' | 'new'
  draft: Draft
  selectedFeatureId: string | null
  rightTab: RightTab
  rightOpen: boolean
  sidebarOpen: boolean
  sidebarWidth: number
  setSidebarWidth(w: number): void
  modal: Modal
  modelPickerOpen: boolean
  /** app self-update state */
  update: UpdateState | null
  /** when each thread's current/last agent turn started and ended */
  turns: Record<string, { startedAt?: number; endedAt?: number }>
  /** threads whose agent finished while you weren't looking (finish time) */
  unseen: Record<string, number>
  /** bump to ask the composer to take focus */
  focusTick: number
  toasts: Toast[]
  /** bumps whenever the agent changes files, so panels can refresh */
  fsTick: Record<string, number>
  init(): Promise<void>
  select(id: string | null): void
  markSeen(id: string): void
  startNew(kind: ThreadKind, projectId?: string | null): void
  setDraft(patch: Partial<Draft>): void
  setRightTab(t: RightTab): void
  toggleRight(): void
  toggleSidebar(): void
  openModal(m: Modal): void
  setModelPicker(open: boolean): void
  focusComposer(): void
  toast(kind: Toast['kind'], message: string): void
  dismissToast(id: number): void
  loadThread(featureId: string): Promise<void>
  setSettings(s: Settings): void
  upsertProject(p: Project): void
  removeProject(id: string): void
  refreshIntegrations(): Promise<IntegrationStatus[]>
}

let toastId = 0
const LS = { selected: 'sf.selectedFeature', right: 'sf.rightOpen', sidebar: 'sf.sidebarOpen', sidebarWidth: 'sf.sidebarWidth', draft: 'sf.draft', unseen: 'sf.unseen' }
const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v === null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

const defaultDraft: Draft = { kind: 'feature', projectId: null, agent: 'claude', model: '', effort: '', permissionMode: 'acceptEdits', baseBranch: '' }

export const useStore = create<State>((set, get) => ({
  ready: false,
  projects: [],
  features: [],
  settings: null,
  models: null,
  integrations: null,
  threads: {},
  statuses: {},
  requests: {},
  processes: {},
  procOutput: {},
  deploys: {},
  mailTick: 0,
  checks: {},
  view: 'new',
  draft: { ...defaultDraft, ...read<Partial<Draft>>(LS.draft, {}) },
  selectedFeatureId: null,
  rightTab: 'preview',
  rightOpen: read(LS.right, true),
  sidebarOpen: read(LS.sidebar, true),
  sidebarWidth: read(LS.sidebarWidth, 272),
  modal: null,
  modelPickerOpen: false,
  update: null,
  turns: {},
  unseen: read<Record<string, number>>(LS.unseen, {}),
  focusTick: 0,
  toasts: [],
  fsTick: {},

  async init() {
    const [projects, features, settings, statuses, models, pending, processes, deploys] = await Promise.all([
      window.api.listProjects(),
      window.api.listFeatures(),
      window.api.getSettings(),
      window.api.agentStatuses(),
      window.api.listModels().catch(() => null),
      window.api.pendingRequests().catch(() => [] as PendingRequest[]),
      window.api.listProcesses().catch(() => [] as ProcessInfo[]),
      window.api.deployStates().catch(() => [] as DeployState[])
    ])
    const requests: Record<string, PendingRequest[]> = {}
    for (const r of pending) (requests[r.featureId] ??= []).push(r)
    let selected = read<string | null>(LS.selected, null)
    if (!features.some((f) => f.id === selected)) selected = null
    const draft = get().draft
    if (!projects.some((p) => p.id === draft.projectId)) draft.projectId = projects[0]?.id ?? null
    if (!draft.projectId && draft.kind === 'feature') draft.kind = 'chat'
    set({
      projects,
      features,
      settings,
      models,
      draft: { ...draft },
      statuses: Object.fromEntries(statuses.map((s) => [s.featureId, s])),
      turns: Object.fromEntries(statuses.filter((s) => s.running).map((s) => [s.featureId, { startedAt: Date.now() }])),
      requests,
      processes: Object.fromEntries(processes.map((p) => [p.id, p])),
      deploys: Object.fromEntries(deploys.map((d) => [`${d.projectId}:${d.envId}`, d])),
      selectedFeatureId: selected,
      view: selected ? 'thread' : 'new',
      ready: true
    })
    if (selected) void get().loadThread(selected)
    void get().refreshIntegrations()
    void window.api.updateState().then((u) => set({ update: u })).catch(() => {})
    window.api.on('update:changed', (u) => set({ update: u }))

    window.api.on('agent:item', ({ featureId, item }) => {
      const t = get().threads[featureId]
      if (t) {
        const i = t.findIndex((x) => x.id === item.id)
        const next = i >= 0 ? t.map((x, j) => (j === i ? item : x)) : [...t, item]
        set({ threads: { ...get().threads, [featureId]: next } })
      }
      if (item.role === 'tool' && item.tool?.status !== 'running' && /Edit|Write|Bash|file|Notebook/i.test(item.tool?.name ?? '')) {
        set({ fsTick: { ...get().fsTick, [featureId]: (get().fsTick[featureId] ?? 0) + 1 } })
      }
    })
    window.api.on('agent:status', (s) => {
      const was = get().statuses[s.featureId]?.running ?? false
      const turn = get().turns[s.featureId] ?? {}
      if (!was && s.running) set({ turns: { ...get().turns, [s.featureId]: { startedAt: Date.now() } } })
      if (was && !s.running) {
        set({ turns: { ...get().turns, [s.featureId]: { ...turn, endedAt: Date.now() } } })
        // Finished while you were elsewhere: mark it, so the sidebar and Dock show it's your turn there.
        const looking = get().view === 'thread' && get().selectedFeatureId === s.featureId && document.hasFocus()
        if (!looking) {
          const unseen = { ...get().unseen, [s.featureId]: Date.now() }
          set({ unseen })
          write(LS.unseen, unseen)
        }
      }
      set({ statuses: { ...get().statuses, [s.featureId]: s } })
      if (!s.running) set({ fsTick: { ...get().fsTick, [s.featureId]: (get().fsTick[s.featureId] ?? 0) + 1 } })
    })
    window.api.on('feature:changed', (f) => {
      const list = get().features
      const i = list.findIndex((x) => x.id === f.id)
      set({ features: i >= 0 ? list.map((x) => (x.id === f.id ? f : x)) : [...list, f] })
    })
    window.api.on('feature:removed', ({ id }) => {
      const features = get().features.filter((f) => f.id !== id)
      set({ features })
      if (get().selectedFeatureId === id) get().startNew(get().draft.kind)
    })
    window.api.on('agent:request', (r) => {
      const list = get().requests[r.featureId] ?? []
      if (!list.some((x) => x.id === r.id)) set({ requests: { ...get().requests, [r.featureId]: [...list, r] } })
    })
    window.api.on('agent:request-resolved', ({ featureId, id }) => {
      set({ requests: { ...get().requests, [featureId]: (get().requests[featureId] ?? []).filter((x) => x.id !== id) } })
    })
    window.api.on('process:changed', (p) => set({ processes: { ...get().processes, [p.id]: p } }))
    window.api.on('process:removed', ({ id }) => {
      const { [id]: _gone, ...rest } = get().processes
      const { [id]: _out, ...outRest } = get().procOutput
      set({ processes: rest, procOutput: outRest })
    })
    // Batch output so a chatty dev server doesn't re-render on every chunk.
    let pendingOut: Record<string, string> = {}
    let flushScheduled = false
    window.api.on('process:output', ({ id, data }) => {
      pendingOut[id] = (pendingOut[id] ?? '') + data
      if (flushScheduled) return
      flushScheduled = true
      setTimeout(() => {
        const next = { ...get().procOutput }
        for (const [k, v] of Object.entries(pendingOut)) next[k] = ((next[k] ?? '') + v).slice(-200_000)
        pendingOut = {}
        flushScheduled = false
        set({ procOutput: next })
      }, 120)
    })
    window.api.on('mail:received', (m) => {
      set({ mailTick: get().mailTick + 1 })
      get().toast('info', `📬 Email captured: “${m.subject}” to ${m.to[0] ?? ''}`)
    })
    window.api.on('checks:changed', (c) => set({ checks: { ...get().checks, [c.featureId]: c } }))
    window.api.on('deploy:changed', (d) => set({ deploys: { ...get().deploys, [`${d.projectId}:${d.envId}`]: d } }))
    window.api.on('project:changed', (p) => get().upsertProject(p))
    window.api.on('settings:changed', (s) => set({ settings: s }))
    window.api.on('toast', ({ kind, message }) => get().toast(kind, message))
  },

  select(id) {
    set({ selectedFeatureId: id, view: id ? 'thread' : 'new', modelPickerOpen: false })
    if (id && get().unseen[id]) get().markSeen(id)
    write(LS.selected, id)
    if (id && !get().threads[id]) void get().loadThread(id)
    if (id) void window.api.ensureServices(id).catch(() => {})
    get().focusComposer()
  },

  markSeen(id) {
    const { [id]: _gone, ...rest } = get().unseen
    set({ unseen: rest })
    write(LS.unseen, rest)
  },

  startNew(kind, projectId) {
    const cur = get().features.find((f) => f.id === get().selectedFeatureId)
    const pid = projectId !== undefined ? projectId : (cur?.projectId ?? get().draft.projectId ?? get().projects[0]?.id ?? null)
    get().setDraft({ kind: kind === 'feature' && !pid ? 'chat' : kind, projectId: pid })
    set({ view: 'new', selectedFeatureId: null, modelPickerOpen: false })
    write(LS.selected, null)
    get().focusComposer()
  },

  setDraft(patch) {
    const draft = { ...get().draft, ...patch }
    set({ draft })
    write(LS.draft, { agent: draft.agent, model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode, kind: draft.kind, projectId: draft.projectId })
  },

  setRightTab(t) {
    // Review & ship isn't a side view any more: it opens as a focused dialog.
    if (t === 'ship') {
      const id = get().selectedFeatureId
      if (id) set({ modal: { kind: 'ship', featureId: id } })
      return
    }
    set({ rightTab: t, rightOpen: true })
    write(LS.right, true)
  },

  toggleRight() {
    set({ rightOpen: !get().rightOpen })
    write(LS.right, get().rightOpen)
  },

  setSidebarWidth(w) {
    set({ sidebarWidth: w })
    write(LS.sidebarWidth, w)
  },

  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen })
    write(LS.sidebar, get().sidebarOpen)
  },

  openModal(m) {
    set({ modal: m })
  },

  setModelPicker(open) {
    set({ modelPickerOpen: open })
  },

  focusComposer() {
    set({ focusTick: get().focusTick + 1 })
  },

  toast(kind, message) {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, kind, message }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  async loadThread(featureId) {
    const items = await window.api.getThread(featureId)
    set({ threads: { ...get().threads, [featureId]: items } })
  },

  setSettings(s) {
    set({ settings: s })
  },

  upsertProject(p) {
    const list = get().projects
    set({ projects: list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] })
  },

  removeProject(id) {
    const features = get().features.filter((f) => f.projectId !== id)
    set({ projects: get().projects.filter((p) => p.id !== id), features })
    if (!features.some((f) => f.id === get().selectedFeatureId)) get().startNew('chat', null)
  },

  async refreshIntegrations() {
    const list = await window.api.integrations().catch(() => [] as IntegrationStatus[])
    set({ integrations: list })
    return list
  }
}))

/** Run an async action, surfacing errors as toasts. Returns undefined on failure. */
export async function act<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn()
    if (success) useStore.getState().toast('success', success)
    return r
  } catch (e) {
    useStore.getState().toast('error', (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    return undefined
  }
}

/** Like act(), but reports success explicitly — for actions that return nothing. */
export async function actOk(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  const r = await act(async () => {
    await fn()
    return true as const
  }, success)
  return r === true
}

export function useSelected(): { feature: Feature | null; project: Project | null } {
  const feature = useStore((s) => (s.view === 'thread' ? (s.features.find((f) => f.id === s.selectedFeatureId) ?? null) : null))
  const project = useStore((s) => (feature?.projectId ? (s.projects.find((p) => p.id === feature.projectId) ?? null) : null))
  return { feature, project }
}

/** Threads in sidebar order: general chats first, then each project's threads, newest first. */
/** Shipped changes and long-idle chats: tucked into the sidebar's "Done & older" section. */
export function isDone(f: Feature, now = Date.now()): boolean {
  if (f.kind === 'chat') return now - f.updatedAt > 14 * 24 * 60 * 60_000
  return !!f.cleanedUp || f.stage === 'merged' || f.stage === 'deployed'
}

/** Active threads in sidebar order (⌘1–9 follow this). */
export function orderedThreads(s: Pick<State, 'features' | 'projects'>): Feature[] {
  const live = s.features.filter((f) => f.stage !== 'archived' && !isDone(f))
  const byNew = (a: Feature, b: Feature) => b.createdAt - a.createdAt
  const general = live.filter((f) => !f.projectId).sort(byNew)
  return [...general, ...s.projects.flatMap((p) => live.filter((f) => f.projectId === p.id).sort(byNew))]
}
