import { createServer, type Server, type Socket } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MailMessage, MailSummary } from '@shared/types'
import { uid } from '@shared/util'

// ---------------- MIME ----------------

interface Part {
  headers: [string, string][]
  body: string // raw (still transfer-encoded)
}

function splitHeadBody(raw: string): { head: string; body: string } {
  const m = raw.match(/\r?\n\r?\n/)
  if (!m || m.index === undefined) return { head: raw, body: '' }
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) }
}

export function parseHeaders(head: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1][1] += ' ' + line.trim()
    else {
      const i = line.indexOf(':')
      if (i > 0) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()])
    }
  }
  return out
}

const header = (hs: [string, string][], name: string) => hs.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? ''

function param(value: string, name: string): string | undefined {
  const m = value.match(new RegExp(`${name}\\*?=\\s*("([^"]*)"|[^;\\s]+)`, 'i'))
  return m ? (m[2] ?? m[1]).replace(/^"|"$/g, '') : undefined
}

function decodeQP(s: string): Buffer {
  const cleaned = s.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '=' && /^[0-9A-F]{2}$/i.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(cleaned.charCodeAt(i) & 0xff)
  }
  return Buffer.from(bytes)
}

function decodeBody(part: Part): Buffer {
  const enc = header(part.headers, 'content-transfer-encoding').toLowerCase()
  if (enc === 'base64') return Buffer.from(part.body.replace(/\s+/g, ''), 'base64')
  if (enc === 'quoted-printable') return decodeQP(part.body)
  return Buffer.from(part.body, 'binary')
}

/** RFC 2047 encoded words: =?utf-8?B?...?= / =?utf-8?Q?...?= */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, _cs, enc, text) =>
    enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64').toString('utf8') : decodeQP(text.replace(/_/g, ' ')).toString('utf8')
  )
}

interface Parsed {
  text?: string
  html?: string
  attachments: { filename: string; contentType: string; size: number }[]
}

function walk(part: Part, out: Parsed, depth = 0): void {
  const ct = header(part.headers, 'content-type') || 'text/plain'
  const type = ct.split(';')[0].trim().toLowerCase()
  const disposition = header(part.headers, 'content-disposition')
  if (type.startsWith('multipart/') && depth < 10) {
    const boundary = param(ct, 'boundary')
    if (!boundary) return
    const chunks = part.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`))
    for (const c of chunks.slice(1)) {
      if (!c.trim()) continue
      const { head, body } = splitHeadBody(c)
      walk({ headers: parseHeaders(head), body }, out, depth + 1)
    }
    return
  }
  const filename = param(disposition, 'filename') ?? param(ct, 'name')
  if (/attachment/i.test(disposition) || (filename && !type.startsWith('text/'))) {
    out.attachments.push({ filename: decodeWords(filename ?? 'attachment'), contentType: type, size: decodeBody(part).length })
    return
  }
  const text = decodeBody(part).toString('utf8')
  if (type === 'text/html' && out.html === undefined) out.html = text
  else if (type === 'text/plain' && out.text === undefined) out.text = text
}

export function parseMessage(raw: string, featureId: string, envelope: { from: string; to: string[] }): MailMessage {
  const { head, body } = splitHeadBody(raw)
  const headers = parseHeaders(head)
  const parsed: Parsed = { attachments: [] }
  walk({ headers, body }, parsed)
  const date = Date.parse(header(headers, 'date'))
  return {
    id: uid('m_'),
    featureId,
    from: decodeWords(header(headers, 'from')) || envelope.from,
    to: header(headers, 'to') ? decodeWords(header(headers, 'to')).split(/,\s*/) : envelope.to,
    subject: decodeWords(header(headers, 'subject')) || '(no subject)',
    date: Number.isFinite(date) ? date : Date.now(),
    hasHtml: parsed.html !== undefined,
    attachments: parsed.attachments,
    read: false,
    text: parsed.text,
    html: parsed.html,
    headers,
    raw
  }
}

// ---------------- SMTP ----------------

export interface MailHooks {
  onMail(m: MailSummary): void
}

/**
 * A tiny local SMTP server. Each workspace authenticates with its feature id as the
 * username (set in its .env), so captured mail is filed under the right feature.
 */
export class MailCatcher {
  private server: Server | null = null
  port = 0
  private messages = new Map<string, MailMessage>()

  constructor(
    private dir: string,
    private hooks: MailHooks
  ) {
    mkdirSync(dir, { recursive: true })
    this.load()
  }

  private file(featureId: string) {
    return join(this.dir, `${featureId.replace(/[^a-z0-9_-]/gi, '')}.jsonl`)
  }

  private load(): void {
    // Messages are kept on disk per feature; only the newest 300 overall are loaded.
    try {
      for (const f of readdirSync(this.dir).filter((x) => x.endsWith('.jsonl'))) {
        for (const line of readFileSync(join(this.dir, f), 'utf8').split('\n').filter(Boolean).slice(-150)) {
          const m = JSON.parse(line) as MailMessage
          this.messages.set(m.id, m)
        }
      }
    } catch {
      /* fresh start */
    }
  }

  async start(preferred = 2525): Promise<number> {
    for (let port = preferred; port < preferred + 50; port++) {
      const ok = await new Promise<boolean>((resolve) => {
        const srv = createServer((sock) => this.session(sock))
        srv.once('error', () => resolve(false))
        srv.listen(port, '127.0.0.1', () => {
          this.server = srv
          resolve(true)
        })
      })
      if (ok) {
        this.port = port
        return port
      }
    }
    throw new Error('No free port for the mail catcher')
  }

  stop(): void {
    this.server?.close()
  }

  list(featureId: string): MailSummary[] {
    return [...this.messages.values()]
      .filter((m) => m.featureId === featureId)
      .sort((a, b) => b.date - a.date)
      .map(({ text: _t, html: _h, headers: _hd, raw: _r, ...summary }) => summary)
  }

  get(id: string): MailMessage | null {
    const m = this.messages.get(id)
    if (m && !m.read) m.read = true
    return m ?? null
  }

  clear(featureId: string): void {
    for (const [id, m] of this.messages) if (m.featureId === featureId) this.messages.delete(id)
    if (existsSync(this.file(featureId))) writeFileSync(this.file(featureId), '')
  }

  private store(m: MailMessage): void {
    this.messages.set(m.id, m)
    try {
      appendFileSync(this.file(m.featureId), JSON.stringify(m) + '\n')
    } catch {
      /* disk full etc. — keep in memory */
    }
    const { text: _t, html: _h, headers: _hd, raw: _r, ...summary } = m
    this.hooks.onMail(summary)
  }

  private session(sock: Socket): void {
    let buf = ''
    let mode: 'cmd' | 'data' | 'auth-user' | 'auth-pass' = 'cmd'
    let user = 'unknown'
    let from = ''
    let to: string[] = []
    let data = ''
    const reply = (s: string) => sock.write(s + '\r\n')
    reply('220 spindle.local ESMTP Spindle mail catcher')
    sock.setEncoding('binary')
    sock.on('error', () => {})
    sock.on('data', (chunk: string) => {
      buf += chunk
      if (mode === 'data') {
        const end = buf.indexOf('\r\n.\r\n')
        if (end < 0 && !buf.startsWith('.\r\n')) return
        const body = buf.startsWith('.\r\n') ? '' : buf.slice(0, end)
        buf = buf.startsWith('.\r\n') ? buf.slice(3) : buf.slice(end + 5)
        data = body.replace(/\r\n\.\./g, '\r\n.')
        const utf8 = Buffer.from(data, 'binary').toString('utf8')
        this.store(parseMessage(utf8, user, { from, to }))
        reply('250 OK: captured by Spindle (not delivered)')
        mode = 'cmd'
        from = ''
        to = []
      }
      let nl: number
      while (mode !== 'data' && (nl = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        if (mode === 'auth-user') {
          user = Buffer.from(line, 'base64').toString('utf8') || user
          mode = 'auth-pass'
          reply('334 UGFzc3dvcmQ6')
          continue
        }
        if (mode === 'auth-pass') {
          mode = 'cmd'
          reply('235 2.7.0 Authentication successful')
          continue
        }
        const [verb, ...rest] = line.split(' ')
        const arg = rest.join(' ')
        switch (verb.toUpperCase()) {
          case 'EHLO':
            sock.write('250-spindle.local\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n')
            break
          case 'HELO':
            reply('250 spindle.local')
            break
          case 'AUTH': {
            const [mech, initial] = arg.split(' ')
            if (mech?.toUpperCase() === 'PLAIN') {
              const decoded = Buffer.from(initial ?? '', 'base64').toString('utf8').split('\u0000')
              user = decoded[1] || user
              reply('235 2.7.0 Authentication successful')
            } else if (mech?.toUpperCase() === 'LOGIN') {
              if (initial) {
                user = Buffer.from(initial, 'base64').toString('utf8') || user
                mode = 'auth-pass'
                reply('334 UGFzc3dvcmQ6')
              } else {
                mode = 'auth-user'
                reply('334 VXNlcm5hbWU6')
              }
            } else reply('504 Unrecognized authentication type')
            break
          }
          case 'MAIL':
            from = arg.replace(/^FROM:\s*/i, '').replace(/[<>]/g, '').split(' ')[0]
            reply('250 OK')
            break
          case 'RCPT':
            to.push(arg.replace(/^TO:\s*/i, '').replace(/[<>]/g, '').split(' ')[0])
            reply('250 OK')
            break
          case 'DATA':
            mode = 'data'
            reply('354 End data with <CR><LF>.<CR><LF>')
            if (buf) sock.emit('data', '')
            break
          case 'RSET':
            from = ''
            to = []
            reply('250 OK')
            break
          case 'NOOP':
            reply('250 OK')
            break
          case 'QUIT':
            reply('221 Bye')
            sock.end()
            break
          default:
            reply('502 Command not implemented')
        }
      }
    })
  }
}
