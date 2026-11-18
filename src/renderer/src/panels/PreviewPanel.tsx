import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, ArrowRight, ExternalLink, Globe, Link2, Monitor, MousePointerClick, RotateCw, Send, Smartphone, Tablet, Trash2, Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { Attachment, Feature, Project } from '@shared/types'
import { uid } from '@shared/util'
import { Button, Empty, IconButton, Segmented } from '../components/ui'
import { act, actOk, useStore } from '../store'

interface WebviewEl extends HTMLElement {
  src: string
  reload(): void
  goBack(): void
  goForward(): void
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
  capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<{ toDataURL(): string; isEmpty(): boolean }>
}

interface PickInfo {
  tag: string
  text: string
  selector: string
  html: string
  component?: string
  rect: { x: number; y: number; width: number; height: number }
  url: string
}

interface Note {
  id: string
  comment: string
  pick: PickInfo
  shot?: string // base64 png
}

/** Feedback items survive tab switches. */
const useNotes = create<{ notes: Record<string, Note[]>; set(featureId: string, notes: Note[]): void }>((set, get) => ({
  notes: {},
  set: (featureId, notes) => set({ notes: { ...get().notes, [featureId]: notes } })
}))
const NO_NOTES: Note[] = []

// Injected into the previewed page. Talks back through console.log, so the page needs no preload.
const PICKER = `(() => {
  if (window.__spindlePick) window.__spindlePick.stop();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #c4ff48;background:rgba(196,255,72,.14);border-radius:4px;transition:all 60ms;box-shadow:0 0 0 4000px rgba(17,19,15,.18)';
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#11130f;color:#c4ff48;font:12px/1.4 ui-monospace,monospace;padding:3px 7px;border-radius:5px;max-width:420px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  document.documentElement.append(box, tag);
  const css = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 5; n = n.parentElement, i++) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let s = n.tagName.toLowerCase();
      const cls = [...n.classList].filter(c => !/[:\\[\\]\\/]/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.map(c => CSS.escape(c)).join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const component = (el) => {
    for (let n = el; n; n = n.parentElement) {
      let c = n.__vueParentComponent;
      while (c && !(c.type && (c.type.__file || c.type.__name))) c = c.parent;
      if (c) return (c.type.__file || c.type.__name) + (c.type.__name && c.type.__file ? ' (' + c.type.__name + ')' : '');
      const key = Object.keys(n).find(k => k.startsWith('__reactFiber$'));
      if (key) {
        for (let f = n[key]; f; f = f.return) {
          if (f._debugSource) return f._debugSource.fileName + ':' + f._debugSource.lineNumber;
          if (typeof f.type === 'function' && f.type.name && /^[A-Z]/.test(f.type.name)) return f.type.name + ' (React component)';
        }
      }
    }
    return undefined;
  };
  let cur = null;
  const label = (el) => (component(el) || el.tagName.toLowerCase()) + (el.innerText ? ' — "' + el.innerText.trim().slice(0, 40) + '"' : '');
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === tag) return;
    cur = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    tag.textContent = label(el);
    Object.assign(tag.style, { left: Math.max(4, r.left) + 'px', top: (r.top > 28 ? r.top - 26 : r.bottom + 4) + 'px' });
  };
  const click = (e) => {
    if (!cur) return;
    e.preventDefault(); e.stopPropagation();
    const r = cur.getBoundingClientRect();
    const info = { tag: cur.tagName.toLowerCase(), text: (cur.innerText || '').trim().slice(0, 200), selector: css(cur), html: cur.outerHTML.slice(0, 800), component: component(cur), rect: { x: r.left, y: r.top, width: r.width, height: r.height }, url: location.href };
    stop();
    console.log('__SPINDLE_PICK__' + JSON.stringify(info));
  };
  const key = (e) => { if (e.key === 'Escape') { stop(); console.log('__SPINDLE_PICK_CANCEL__'); } };
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };
  function stop() {
    box.remove(); tag.remove();
    removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true);
    removeEventListener('mousedown', block, true); removeEventListener('mouseup', block, true);
    window.__spindlePick = null;
  }
  addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
  addEventListener('mousedown', block, true); addEventListener('mouseup', block, true);
  window.__spindlePick = { stop };
})();`

const VIEWPORTS = { desktop: 0, tablet: 820, mobile: 390 } as const
type Viewport = keyof typeof VIEWPORTS

export function PreviewPanel({ feature, project }: { feature: Feature; project: Project }) {
  const ref = useRef<WebviewEl | null>(null)
  const [url, setUrl] = useState(feature.localUrl ?? '')
  const [linking, setLinking] = useState(false)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [picking, setPicking] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [showErrors, setShowErrors] = useState(false)
  const [sending, setSending] = useState(false)
  const notes = useNotes((s) => s.notes[feature.id] ?? NO_NOTES)
  const setNotes = useNotes((s) => s.set)
  const running = useStore((s) => s.statuses[feature.id]?.running ?? false)
  const wasRunning = useRef(running)

  useEffect(() => {
    setUrl(feature.localUrl ?? '')
  }, [feature.localUrl])

  // When the agent finishes a turn, show the result.
  useEffect(() => {
    if (wasRunning.current && !running) ref.current?.reload()
    wasRunning.current = running
  }, [running])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onNav = () => {
      setUrl(el.getURL())
      setErrors([])
    }
    const onConsole = async (e: Event) => {
      const { message, level } = e as unknown as { message: string; level: number }
      if (message.startsWith('__SPINDLE_PICK__')) {
        const pick = JSON.parse(message.slice('__SPINDLE_PICK__'.length)) as PickInfo
        setPicking(false)
        let shot: string | undefined
        try {
          const pad = 8
          const img = await el.capturePage({
            x: Math.max(0, Math.round(pick.rect.x - pad)),
            y: Math.max(0, Math.round(pick.rect.y - pad)),
            width: Math.max(1, Math.round(pick.rect.width + pad * 2)),
            height: Math.max(1, Math.round(pick.rect.height + pad * 2))
          })
          if (!img.isEmpty()) shot = img.toDataURL().replace(/^data:image\/png;base64,/, '')
        } catch {
          /* screenshot is optional */
        }
        const cur = useNotes.getState().notes[feature.id] ?? []
        setNotes(feature.id, [...cur, { id: uid('n'), comment: '', pick, shot }])
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-note-input]:last-of-type')?.focus(), 50)
      } else if (message === '__SPINDLE_PICK_CANCEL__') setPicking(false)
      else if (level >= 3) setErrors((x) => [...x.slice(-30), message.slice(0, 500)])
    }
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('console-message', onConsole)
    return () => {
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('console-message', onConsole)
    }
  }, [feature.localUrl, feature.id, setNotes])

  const startPicking = async () => {
    if (picking) {
      await ref.current?.executeJavaScript('window.__spindlePick && window.__spindlePick.stop()')
      setPicking(false)
      return
    }
    setPicking(true)
    await ref.current?.executeJavaScript(PICKER).catch(() => setPicking(false))
  }

  const send = async () => {
    const ready = notes.filter((n) => n.comment.trim())
    if (!ready.length) return
    setSending(true)
    const width = VIEWPORTS[viewport] || 'full width'
    const lines = [`Please make these visual changes in the running app (viewport: ${width === 'full width' ? width : width + 'px'}). Keep everything else as it is.`, '']
    const attachments: Attachment[] = []
    ready.forEach((n, i) => {
      lines.push(`${i + 1}. "${n.comment.trim()}"`)
      lines.push(`   Page: ${n.pick.url}`)
      lines.push(`   Element: <${n.pick.tag}>${n.pick.text ? ` "${n.pick.text.slice(0, 80)}"` : ''} — selector \`${n.pick.selector}\``)
      if (n.pick.component) lines.push(`   Source component: ${n.pick.component}`)
      lines.push('   HTML: ```html', `   ${n.pick.html.replace(/\n/g, ' ')}`, '   ```')
      if (n.shot) {
        attachments.push({ mediaType: 'image/png', data: n.shot, name: `element-${i + 1}.png` })
        lines.push(`   (Screenshot ${attachments.length} shows this element.)`)
      }
      lines.push('')
    })
    const ok = await actOk(() => window.api.sendPrompt(feature.id, lines.join('\n'), attachments))
    if (ok) {
      for (const n of ready) void window.api.addVisualNote(feature.id, n.comment.trim())
      setNotes(
        feature.id,
        notes.filter((n) => !n.comment.trim())
      )
      useStore.getState().toast('success', `Sent ${ready.length} change request${ready.length > 1 ? 's' : ''} to the AI`)
    }
    setSending(false)
  }

  if (!feature.localUrl) {
    return (
      <Empty icon={<Globe className="size-8" />} title="No preview yet">
        {project.herdEnabled || project.server !== 'herd' ? (
          <>
            This change doesn&apos;t have a local preview site yet.
            <div className="mt-3">
              <Button
                size="sm"
                variant="primary"
                icon={<Link2 className="size-4" />}
                loading={linking}
                onClick={async () => {
                  setLinking(true)
                  await act(() => window.api.herdLink(feature.id), 'Preview ready')
                  setLinking(false)
                }}
              >
                Start preview
              </Button>
            </div>
          </>
        ) : (
          'Turn on “Its own local site in Herd” in project settings to preview each change.'
        )}
      </Empty>
    )
  }

  const width = VIEWPORTS[viewport]
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <IconButton title="Back" onClick={() => ref.current?.goBack()}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <IconButton title="Forward" onClick={() => ref.current?.goForward()}>
          <ArrowRight className="size-4" />
        </IconButton>
        <IconButton title="Reload" onClick={() => ref.current?.reload()}>
          <RotateCw className="size-4" />
        </IconButton>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (ref.current) ref.current.src = url
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Address"
            className="h-8 w-full rounded-lg bg-raised px-2.5 font-mono text-xs text-muted outline-none focus:text-fg"
          />
        </form>
        <Segmented<Viewport>
          size="sm"
          value={viewport}
          onChange={setViewport}
          options={[
            { value: 'desktop', label: <Monitor className="size-4" />, title: 'Desktop' },
            { value: 'tablet', label: <Tablet className="size-4" />, title: 'Tablet (820px)' },
            { value: 'mobile', label: <Smartphone className="size-4" />, title: 'Mobile (390px)' }
          ]}
        />
        {errors.length > 0 && (
          <button
            type="button"
            onClick={() => setShowErrors(!showErrors)}
            className="ml-1 flex h-8 items-center gap-1.5 rounded-lg bg-bad/15 px-2.5 text-xs font-medium text-bad hover:bg-bad/25"
          >
            <AlertTriangle className="size-3.5" /> {errors.length}
          </button>
        )}
        <IconButton title="Open in browser" onClick={() => void window.api.openExternal(url)}>
          <ExternalLink className="size-4" />
        </IconButton>
      </div>

      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Button size="sm" variant={picking ? 'primary' : 'secondary'} icon={<MousePointerClick className="size-4" />} onClick={startPicking}>
          {picking ? 'Click an element… (Esc to cancel)' : 'Point at something to change'}
        </Button>
        <span className="truncate text-xs text-faint">{picking ? 'Hover the page — the highlighted part is what you’ll comment on.' : 'Pick parts of the page, say what to change, and send them all at once.'}</span>
      </div>

      {showErrors && errors.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-b border-bad/30 bg-bad/[0.06] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-bad">The page reported {errors.length} error{errors.length > 1 ? 's' : ''}</span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              icon={<Wand2 className="size-4" />}
              onClick={() =>
                act(
                  () => window.api.sendPrompt(feature.id, `The page ${url} shows these errors in the browser console. Find the cause and fix it:\n\n\`\`\`\n${errors.slice(-15).join('\n')}\n\`\`\``),
                  'Sent to the AI'
                )
              }
            >
              Fix with AI
            </Button>
            <IconButton title="Clear" className="size-7" onClick={() => setErrors([])}>
              <X className="size-4" />
            </IconButton>
          </div>
          <pre className="selectable font-mono text-xs whitespace-pre-wrap text-bad/90">{errors.slice(-10).join('\n')}</pre>
        </div>
      )}

      <div className={clsx('flex min-h-0 flex-1 justify-center', width && 'bg-bg py-3')}>
        <div className={clsx('h-full', width ? 'overflow-hidden rounded-xl border border-line-strong shadow-2xl' : 'w-full')} style={width ? { width } : undefined}>
          {/* partition keeps cookies (logins) per feature site across reloads */}
          <webview ref={ref as never} src={feature.localUrl} partition={`persist:herd-${feature.herdSite ?? feature.slug}`} key={feature.id} />
        </div>
      </div>

      {notes.length > 0 && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-line bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium">
              {notes.length} change request{notes.length > 1 ? 's' : ''}
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="primary" icon={<Send className="size-4" />} loading={sending} disabled={!notes.some((n) => n.comment.trim())} onClick={send}>
              Send to AI
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {notes.map((n, i) => (
              <li key={n.id} className="flex gap-3 rounded-xl border border-line bg-raised/50 p-2.5">
                {n.shot ? (
                  <img src={`data:image/png;base64,${n.shot}`} alt="" className="h-16 w-24 shrink-0 rounded-md border border-line object-contain bg-bg" />
                ) : (
                  <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-bg text-xs text-faint">{n.pick.tag}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 truncate font-mono text-2xs text-faint" title={n.pick.selector}>
                    {i + 1}. {n.pick.component ?? n.pick.selector}
                  </div>
                  <textarea
                    data-note-input
                    value={n.comment}
                    onChange={(e) => setNotes(feature.id, notes.map((x) => (x.id === n.id ? { ...x, comment: e.target.value } : x)))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.metaKey) void send()
                    }}
                    rows={2}
                    placeholder="What should change? e.g. “Make this button smaller and align it with the heading”"
                    className="w-full resize-none rounded-lg border border-line-strong bg-bg/60 px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent"
                  />
                </div>
                <IconButton title="Remove" className="size-7" onClick={() => setNotes(feature.id, notes.filter((x) => x.id !== n.id))}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
