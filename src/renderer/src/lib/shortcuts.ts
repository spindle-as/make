/** Single source of truth for keyboard shortcuts (also mirrored in the Electron menu). */
export interface Shortcut {
  id: string
  label: string
  group: 'General' | 'Threads' | 'Agent' | 'Panels' | 'View'
  /** e.g. "mod+shift+n", "alt+arrowup", "mod+alt+1" */
  keys: string
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'new-feature', label: 'New feature', group: 'General', keys: 'mod+n' },
  { id: 'new-chat', label: 'New chat', group: 'General', keys: 'mod+shift+n' },
  { id: 'palette', label: 'Command palette', group: 'General', keys: 'mod+k' },
  { id: 'add-project', label: 'Open project', group: 'General', keys: 'mod+o' },
  { id: 'toggle-mode', label: 'Switch Creator / Developer mode', group: 'General', keys: 'mod+shift+d' },
  { id: 'settings', label: 'Settings', group: 'General', keys: 'mod+,' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'General', keys: 'mod+/' },

  { id: 'prev-thread', label: 'Previous thread', group: 'Threads', keys: 'alt+arrowup' },
  { id: 'next-thread', label: 'Next thread', group: 'Threads', keys: 'alt+arrowdown' },
  { id: 'goto-thread', label: 'Go to thread 1–9', group: 'Threads', keys: 'mod+1' },
  { id: 'archive', label: 'Archive thread', group: 'Threads', keys: 'mod+backspace' },
  { id: 'promote', label: 'Continue chat as feature', group: 'Threads', keys: 'mod+shift+f' },

  { id: 'focus-composer', label: 'Focus message box', group: 'Agent', keys: 'mod+l' },
  { id: 'model-picker', label: 'Choose model & reasoning', group: 'Agent', keys: 'mod+shift+m' },
  { id: 'stop', label: 'Stop agent', group: 'Agent', keys: 'mod+.' },
  { id: 'recall', label: 'Edit last message (empty box)', group: 'Agent', keys: 'arrowup' },

  { id: 'toggle-sidebar', label: 'Toggle sidebar', group: 'View', keys: 'mod+b' },
  { id: 'toggle-panel', label: 'Toggle side panel', group: 'View', keys: 'mod+j' },
  { id: 'zoom-in', label: 'Bigger text', group: 'View', keys: 'mod+=' },
  { id: 'zoom-out', label: 'Smaller text', group: 'View', keys: 'mod+-' },
  { id: 'zoom-reset', label: 'Actual size', group: 'View', keys: 'mod+0' },
  { id: 'open-editor', label: 'Open in editor', group: 'View', keys: 'mod+e' },
  { id: 'open-terminal', label: 'Open in Terminal', group: 'View', keys: 'mod+shift+t' },
  { id: 'open-site', label: 'Open local site', group: 'View', keys: 'mod+shift+b' },

  { id: 'tab-preview', label: 'Preview', group: 'Panels', keys: 'mod+alt+1' },
  { id: 'tab-changes', label: 'Changes', group: 'Panels', keys: 'mod+alt+2' },
  { id: 'tab-ship', label: 'Review & ship', group: 'Panels', keys: 'mod+alt+3' },
  { id: 'tab-email', label: 'Email', group: 'Panels', keys: 'mod+alt+4' },
  { id: 'tab-data', label: 'Data', group: 'Panels', keys: 'mod+alt+5' },
  { id: 'tab-logs', label: 'Logs', group: 'Panels', keys: 'mod+alt+6' },
  { id: 'tab-terminal', label: 'Processes', group: 'Panels', keys: 'mod+alt+7' },
  { id: 'tab-setup', label: 'Setup', group: 'Panels', keys: 'mod+alt+8' }
]

const GLYPH: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  enter: '↵',
  escape: 'Esc',
  '=': '+'
}

export function formatKeys(keys: string): string[] {
  return keys.split('+').map((k) => GLYPH[k] ?? k.toUpperCase())
}

export function shortcutFor(id: string): string[] | undefined {
  const s = SHORTCUTS.find((x) => x.id === id)
  return s ? formatKeys(s.keys) : undefined
}

/** Normalise a KeyboardEvent to our "mod+shift+x" notation. Uses `code` for digits so ⌥ doesn't break them. */
export function eventKeys(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('mod')
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  let key = e.key.toLowerCase()
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase()
  if (key === '+') key = '='
  parts.push(key)
  return parts.join('+')
}

/** Shortcut id for an event, or null. Digits 1–9 with mod map to goto-thread. */
export function matchShortcut(e: KeyboardEvent): { id: string; arg?: number } | null {
  const k = eventKeys(e)
  const m = k.match(/^mod\+([1-9])$/)
  if (m) return { id: 'goto-thread', arg: Number(m[1]) }
  if (k === 'mod+shift+=') return { id: 'zoom-in' }
  const s = SHORTCUTS.find((x) => x.keys === k && x.id !== 'recall' && x.id !== 'goto-thread')
  return s ? { id: s.id } : null
}
