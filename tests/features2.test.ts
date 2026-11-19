import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ClaudeStreamParser } from '../src/main/agents/claudeParser'
import { claudeArgs, codexArgs } from '../src/main/agents'
import { configFromEnv, featureDbName, parseEnv, provision } from '../src/main/db'
import { parseCodexConfig, parseCodexModels } from '../src/main/models'
import { environmentFromSite, scoreSites } from '../src/main/ploi'
import { slugFromPrompt, titleFromPrompt } from '../src/shared/util'
import type { Feature, Settings } from '../src/shared/types'

const j = (o: unknown) => JSON.stringify(o)

describe('Claude partial-message streaming', () => {
  it('streams deltas and replaces them in place with the final block', () => {
    const p = new ClaudeStreamParser()
    p.feed(j({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }))
    const a = p.feed(j({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } }))
    const b = p.feed(j({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } }))
    expect(a.items[0]).toMatchObject({ id: 'm1-0', text: 'Hel', status: 'running' })
    expect(b.items[0]).toMatchObject({ id: 'm1-0', text: 'Hello' })
    const fin = p.feed(j({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }] } }))
    expect(fin.items[0]).toMatchObject({ id: 'm1-0', text: 'Hello' })
    expect(fin.items[0].status).toBeUndefined()
  })

  it('keeps separate ids for multiple text blocks in one message', () => {
    const p = new ClaudeStreamParser()
    p.feed(j({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm2' } } }))
    p.feed(j({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'First' } } }))
    const f1 = p.feed(j({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'First' }] } }))
    p.feed(j({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Second' } } }))
    const f2 = p.feed(j({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Second' }] } }))
    expect(f1.items[0].id).toBe('m2-0')
    expect(f2.items[0].id).toBe('m2-2')
  })
})

const feature = { kind: 'feature', worktreePath: '/w', permissionMode: 'acceptEdits' } as Feature
describe('model + effort flags', () => {
  it('passes claude model, effort and budget', () => {
    const a = claudeArgs({ ...feature, model: 'opus', effort: 'xhigh', maxBudgetUsd: 2 }, {} as Settings, 'ctx')
    expect(a).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'xhigh', '--max-budget-usd', '2', '--include-partial-messages']))
  })
  it('an explicit empty model on the thread overrides the settings default', () => {
    const a = claudeArgs({ ...feature, model: '' }, { claudeModel: 'opus' } as Settings, 'ctx')
    expect(a).not.toContain('--model')
  })
  it('passes codex reasoning effort as a config override', () => {
    const a = codexArgs({ ...feature, agent: 'codex', model: 'gpt-6-astra', effort: 'high' }, {} as Settings)
    expect(a).toEqual(expect.arrayContaining(['-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="high"']))
  })
})

describe('codex model catalog', () => {
  it('parses the cache, hides hidden models and keeps per-model efforts', () => {
    const models = parseCodexModels(
      j({
        models: [
          { slug: 'b', display_name: 'B', priority: 2, visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra', description: 'Delegates' }] },
          { slug: 'hidden', priority: 1, visibility: 'hide' },
          { slug: 'a', display_name: 'A', priority: 1, visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }] }
        ]
      })
    )
    expect(models.map((m) => m.id)).toEqual(['a', 'b'])
    expect(models[0].defaultEffort).toBe('medium')
    expect(models[1].efforts).toEqual([
      { id: 'low', label: 'Low', description: undefined },
      { id: 'ultra', label: 'Ultra', description: 'Delegates' }
    ])
  })
  it('reads top-level model settings from config.toml', () => {
    expect(parseCodexConfig('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n[profiles.x]\nmodel = "other"')).toEqual({ model: 'gpt-6-astra', effort: 'high' })
  })
})

describe('ploi site matching', () => {
  const sites = [
    { serverId: '1', serverName: 'web', serverIp: '1.2.3.4', siteId: '10', domain: 'shop.example.com', systemUser: 'ploi' },
    { serverId: '1', serverName: 'web', serverIp: '1.2.3.4', siteId: '11', domain: 'staging.shop.example.com', systemUser: 'ploi' },
    { serverId: '2', serverName: 'other', siteId: '12', domain: 'blog.example.com' }
  ]
  it('ranks sites that match the project name first', () => {
    const ranked = scoreSites(sites, { name: 'shop', slug: 'shop', githubRepo: 'acme/shop' })
    expect(ranked.slice(0, 2).map((s) => s.siteId).sort()).toEqual(['10', '11'])
    expect(ranked[2].score).toBe(0)
  })
  it('builds environments with names, URL, ssh target and path', () => {
    const prod = environmentFromSite(sites[0], 'main', [])
    expect(prod).toMatchObject({ name: 'production', branch: 'main', url: 'https://shop.example.com', sshTarget: 'ploi@1.2.3.4', remotePath: '/home/ploi/shop.example.com' })
    expect(environmentFromSite(sites[1], 'main', [prod]).name).toBe('staging')
  })
})

describe('titles and slugs from prompts', () => {
  it('derives readable titles and branch slugs', () => {
    expect(titleFromPrompt('please add a CSV export to the invoices page. Include totals.')).toBe('Add a CSV export to the invoices page.')
    expect(slugFromPrompt('Add a CSV export to the invoices page and include totals')).toBe('csv-export-invoices-page-include')
  })
})

describe('per-feature databases', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-db-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('parses .env values and database config', () => {
    const env = parseEnv('DB_CONNECTION=mysql\nDB_PORT=3308\nDB_PASSWORD="se cret" \nDB_DATABASE=shop # comment\n')
    expect(configFromEnv(env)).toEqual({ driver: 'mysql', host: '127.0.0.1', port: 3308, user: 'root', password: 'se cret', database: 'shop' })
    expect(configFromEnv({ DB_CONNECTION: 'pgsql' })?.port).toBe(5432)
    expect(configFromEnv({})).toBeNull()
  })

  it('names feature databases safely', () => {
    expect(featureDbName('my-shop', 'csv-export')).toBe('my_shop_csv_export')
    expect(featureDbName('a'.repeat(40), 'b'.repeat(40)).length).toBeLessThanOrEqual(63)
  })

  it('gives a sqlite worktree its own copied database file', async () => {
    const main = join(root, 'main')
    const wt = join(root, 'wt')
    mkdirSync(join(main, 'database'), { recursive: true })
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(main, 'database', 'database.sqlite'), 'MAINDATA')
    // absolute path pointing at the main checkout must be re-pointed to the worktree
    writeFileSync(join(wt, '.env'), `APP_NAME=x\nDB_CONNECTION=sqlite\nDB_DATABASE=${join(main, 'database', 'database.sqlite')}\n`)
    const lines: string[] = []
    const r = await provision(main, wt, 'ignored', 'clone', (l) => lines.push(l))
    const target = join(wt, 'database', 'database.sqlite')
    expect(r).toMatchObject({ driver: 'sqlite', name: target, created: true })
    expect(readFileSync(target, 'utf8')).toBe('MAINDATA')
    expect(readFileSync(join(wt, '.env'), 'utf8')).toContain(`DB_DATABASE=${target}`)
    expect(existsSync(join(main, 'database', 'database.sqlite'))).toBe(true)
  })

  it('creates an empty sqlite file for the default relative path', async () => {
    const main = join(root, 'main2')
    const wt = join(root, 'wt2')
    mkdirSync(main, { recursive: true })
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, '.env'), 'DB_CONNECTION=sqlite\n')
    const r = await provision(main, wt, 'x', 'empty', () => {})
    expect(r?.name).toBe(join(wt, 'database', 'database.sqlite'))
    // Always absolute now: Laravel resolves relative paths against the current directory.
    expect(readFileSync(join(wt, '.env'), 'utf8')).toContain(`DB_DATABASE=${join(wt, 'database', 'database.sqlite')}`)
  })
})
