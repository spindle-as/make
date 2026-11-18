import { formatKeys, SHORTCUTS, type Shortcut } from '../lib/shortcuts'
import { Kbd, Modal } from './ui'

const GROUPS: Shortcut['group'][] = ['General', 'Threads', 'Agent', 'View', 'Panels']

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={760}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        {GROUPS.map((g) => (
          <section key={g}>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-faint uppercase">{g}</h3>
            <ul className="flex flex-col">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <li key={s.id} className="flex items-center justify-between border-b border-line/60 py-2 text-sm">
                  <span className="text-fg">{s.label}</span>
                  <Kbd keys={s.id === 'goto-thread' ? ['⌘', '1–9'] : formatKeys(s.keys)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-faint uppercase">Everywhere</h3>
          <ul className="flex flex-col">
            {[
              ['Send message', ['↵']],
              ['New line', ['⇧', '↵']],
              ['Move through lists & menus', ['↑', '↓']],
              ['Change reasoning level (model menu)', ['←', '→']],
              ['Next / previous control', ['Tab']],
              ['Close dialog or menu', ['Esc']]
            ].map(([label, keys]) => (
              <li key={label as string} className="flex items-center justify-between border-b border-line/60 py-2 text-sm">
                <span className="text-fg">{label as string}</span>
                <Kbd keys={keys as string[]} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
