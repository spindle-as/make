import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { claudeArgs, userMessageLine } from '../src/main/agents'
import * as dbb from '../src/main/dbbrowse'
import { MailCatcher, decodeWords, parseMessage } from '../src/main/mail'
import { composeBody, detectChecks, latestChecks } from '../src/main/review'
import type { Feature, MailSummary, Settings } from '../src/shared/types'

const root = mkdtempSync(join(tmpdir(), 'sf-spindle-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const MULTIPART = [
  'From: "Shop" <hello@shop.test>',
  'To: ada@example.com',
  'Subject: =?utf-8?B?V2VsY29tZSDwn46J?=',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="mix"',
  '',
  '--mix',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hei Ada, velkommen til butikken =E2=80=93 god handel!',
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<h1>Welcome</h1>',
  '--alt--',
  '--mix',
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 fake').toString('base64'),
  '--mix--',
  ''
].join('\r\n')

describe('mail capture', () => {
  it('parses multipart messages, encodings and attachments', () => {
    const m = parseMessage(MULTIPART, 'f1', { from: '', to: [] })
    expect(m.subject).toBe('Welcome 🎉')
    expect(m.text).toContain('velkommen til butikken – god handel!')
    expect(m.html).toBe('<h1>Welcome</h1>')
    expect(m.attachments).toEqual([{ filename: 'invoice.pdf', contentType: 'application/pdf', size: 13 }])
    expect(decodeWords('=?utf-8?Q?Hei_p=C3=A5_deg?=')).toBe('Hei på deg')
  })

  it('accepts mail over SMTP, files it under the authenticated feature and never delivers it', async () => {
    const got: MailSummary[] = []
    const catcher = new MailCatcher(join(root, 'mail'), { onMail: (m) => got.push(m) })
    const port = await catcher.start(39025)
    const lines: string[] = []
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ port, host: '127.0.0.1' })
      const script = [
        'EHLO laravel',
        `AUTH PLAIN ${Buffer.from('\u0000f_abc\u0000spindle').toString('base64')}`,
        'MAIL FROM:<hello@shop.test>',
        'RCPT TO:<ada@example.com>',
        'DATA',
        MULTIPART.replace(/\r\n\./g, '\r\n..') + '\r\n.',
        'QUIT'
      ]
      let step = 0
      sock.setEncoding('utf8')
      sock.on('data', (d: string) => {
        lines.push(d)
        if (step < script.length && /^(220|250|235|354)/m.test(d)) sock.write(script[step++] + '\r\n')
      })
      sock.on('end', () => resolve())
      sock.on('error', reject)
    })
    catcher.stop()
    expect(lines.join('')).toContain('250 OK: captured by Spindle (not delivered)')
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ featureId: 'f_abc', subject: 'Welcome 🎉', hasHtml: true })
    expect(catcher.list('f_abc')).toHaveLength(1)
    expect(catcher.get(got[0].id)?.html).toBe('<h1>Welcome</h1>')
    catcher.clear('f_abc')
    expect(catcher.list('f_abc')).toEqual([])
  })
})

describe('database browser (sqlite)', () => {
  const dir = join(root, 'app')
  mkdirSync(join(dir, 'database'), { recursive: true })
  writeFileSync(join(dir, '.env'), 'DB_CONNECTION=sqlite\n')
  execFileSync('sqlite3', [join(dir, 'database', 'database.sqlite'), "CREATE TABLE users (id integer primary key, name text, bio text); INSERT INTO users VALUES (1,'Ada',NULL),(2,'Linus','tabs\tand\nnewlines');"])

  it('lists tables and pages through rows, keeping NULLs distinct', async () => {
    const t = await dbb.tables(dir)
    expect(t.tables.map((x) => x.name)).toEqual(['users'])
    const r = await dbb.rows(dir, 'users', 0)
    expect(r.columns).toEqual(['id', 'name', 'bio'])
    expect(r.rows[0]).toEqual(['1', 'Ada', null])
    await expect(dbb.rows(dir, 'users; DROP TABLE users', 0)).rejects.toThrow(/Unknown table/)
  })

  it('keeps queries read-only unless changes are allowed', async () => {
    await expect(dbb.query(dir, 'DELETE FROM users', false)).rejects.toThrow(/Allow changes/)
    await expect(dbb.query(dir, 'SELECT 1; DELETE FROM users', true)).rejects.toThrow(/one statement/)
    expect((await dbb.query(dir, "SELECT name FROM users WHERE name = 'a;b' OR id = 1", false)).rows).toEqual([['Ada']])
    await dbb.query(dir, "UPDATE users SET name = 'Grace' WHERE id = 1", true)
    expect((await dbb.query(dir, 'SELECT name FROM users WHERE id = 1', false)).rows).toEqual([['Grace']])
  })

  it('snapshots and restores', async () => {
    const snaps = join(root, 'snaps')
    const s = await dbb.snapshot(dir, snaps, 'f1', 'Before cleanup')
    expect(s.label).toBe('Before cleanup')
    await dbb.query(dir, 'DELETE FROM users', true)
    await dbb.restore(dir, snaps, 'f1', s.id)
    expect((await dbb.query(dir, 'SELECT COUNT(*) FROM users', false)).rows).toEqual([['2']])
    expect(dbb.listSnapshots(snaps, 'f1').map((x) => x.id)).toEqual([s.id])
  })

  it('refuses non-local databases', () => {
    const remote = join(root, 'remote')
    mkdirSync(remote, { recursive: true })
    writeFileSync(join(remote, '.env'), 'DB_CONNECTION=mysql\nDB_HOST=db.prod.example.com\nDB_DATABASE=shop\n')
    expect(() => dbb.workspaceDb(remote)).toThrow(/only browses local/)
  })
})

describe('review', () => {
  it('detects checks from project files', () => {
    const d = join(root, 'laravel')
    mkdirSync(join(d, 'tests'), { recursive: true })
    mkdirSync(join(d, 'vendor', 'bin'), { recursive: true })
    writeFileSync(join(d, 'artisan'), '')
    writeFileSync(join(d, 'vendor', 'bin', 'pint'), '')
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', test: 'echo "Error: no test specified" && exit 1' } }))
    expect(detectChecks(d).map((c) => c.command)).toEqual(['php artisan test', 'vendor/bin/pint --test', 'npm run build'])
  })

  const facts = { files: [{ path: 'app/X.php', status: 'M' }], stat: '1 file changed', migrations: ['database/migrations/2026_01_01_create_customers_table.php'], commits: [], diff: '' }
  const feature = { title: 'Customers', updatedAt: 1000, visualNotes: ['Make the save button smaller'] } as Feature

  it('never claims tests passed without a recorded run', () => {
    const body = composeBody(feature, facts, null, 'Added customers.')
    expect(body).toContain('No checks were run in Spindle')
    expect(body).not.toMatch(/✅/)
    expect(body).toContain('2026_01_01_create_customers_table.php')
    expect(body).toContain('Make the save button smaller')
  })

  it('reports the latest result of each check, failures included', () => {
    const checks = [
      { name: 'Tests', command: 'php artisan test', ok: false, code: 1, at: 2000, durationMs: 4000, summary: '' },
      { name: 'Tests', command: 'php artisan test', ok: true, code: 0, at: 3000, durationMs: 5000, summary: '' },
      { name: 'Code style', command: 'pint --test', ok: false, code: 1, at: 3000, durationMs: 900, summary: '' }
    ]
    expect(latestChecks(checks)).toHaveLength(2)
    const body = composeBody({ ...feature, checks }, facts, null, '')
    expect(body).toContain('✅ Passed (5s)')
    expect(body).toContain('❌ Failed (exit 1)')
    expect(body).toContain('Some checks failed')
  })
})

describe('agent safety', () => {
  it('passes tool restrictions to Claude and keeps flags in order', () => {
    const a = claudeArgs({ kind: 'feature', permissionMode: 'acceptEdits' } as Feature, {} as Settings, 'ctx', ['Bash(git push:*)', 'Bash(gh:*)'])
    const i = a.indexOf('--disallowedTools')
    expect(a.slice(i, i + 3)).toEqual(['--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'])
    expect(a[i + 3]).toBe('--append-system-prompt')
  })
  it('sends screenshots as image blocks before the text', () => {
    const j = JSON.parse(userMessageLine('make it smaller', [{ mediaType: 'image/png', data: 'AAAA' }]))
    expect(j.message.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
    expect(j.message.content[1]).toEqual({ type: 'text', text: 'make it smaller' })
  })
})
