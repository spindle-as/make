import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureDatabase, parseEnv, provision, shareSqlite, sqlitePath } from '../src/main/db'

function project(envDb = '# DB_DATABASE=laravel', parent = mkdtempSync(join(tmpdir(), 'sf-sqlite-'))) {
  const main = join(parent, 'main')
  const wt = join(parent, 'wt')
  mkdirSync(join(main, 'database'), { recursive: true })
  mkdirSync(wt)
  writeFileSync(join(main, 'database', 'database.sqlite'), 'MAIN')
  const env = `APP_NAME=x\nDB_CONNECTION=sqlite\n${envDb}\n`
  writeFileSync(join(main, '.env'), env)
  writeFileSync(join(wt, '.env'), env)
  return { main, wt }
}
const dbOf = (dir: string) => parseEnv(readFileSync(join(dir, '.env'), 'utf8')).DB_DATABASE

describe('SQLite per change', () => {
  it('copies into the worktree and always writes the absolute path (even when DB_DATABASE was unset)', async () => {
    const { main, wt } = project()
    const r = await provision(main, wt, 'x', 'clone', () => {})
    expect(r?.name).toBe(join(wt, 'database', 'database.sqlite'))
    expect(dbOf(wt)).toBe(join(wt, 'database', 'database.sqlite'))
    expect(readFileSync(join(wt, 'database', 'database.sqlite'), 'utf8')).toBe('MAIN')
  })
  it('creates an empty file for a fresh database', async () => {
    const { main, wt } = project()
    await provision(main, wt, 'x', 'empty', () => {})
    expect(readFileSync(dbOf(wt), 'utf8')).toBe('')
  })
  it('keeps a relative DB_DATABASE location but makes it absolute', async () => {
    const { main, wt } = project('DB_DATABASE=storage/app.sqlite')
    writeFileSync(join(main, 'storage.sqlite'), '')
    mkdirSync(join(main, 'storage'))
    writeFileSync(join(main, 'storage', 'app.sqlite'), 'S')
    await provision(main, wt, 'x', 'clone', () => {})
    expect(dbOf(wt)).toBe(join(wt, 'storage', 'app.sqlite'))
    expect(readFileSync(dbOf(wt), 'utf8')).toBe('S')
  })
  it('maps an absolute path into the main checkout, through symlinks', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'sf-sqlite-'))
    const { main, wt } = project(undefined, parent)
    const link = join(parent, 'linked-main')
    symlinkSync(main, link)
    writeFileSync(join(wt, '.env'), `DB_CONNECTION=sqlite\nDB_DATABASE=${join(link, 'database', 'database.sqlite')}\n`)
    await provision(main, wt, 'x', 'clone', () => {})
    expect(dbOf(wt)).toBe(join(wt, 'database', 'database.sqlite'))
  })
  it('shares by pointing the worktree at the main file (the old bug: it pointed nowhere)', () => {
    const { main, wt } = project()
    expect(shareSqlite(main, wt)).toBe(join(main, 'database', 'database.sqlite'))
    expect(dbOf(wt)).toBe(join(main, 'database', 'database.sqlite'))
  })
  it('quotes paths with spaces', async () => {
    const { main, wt } = project(undefined, join(mkdtempSync(join(tmpdir(), 'sf sqlite ')), ''))
    await provision(main, wt, 'x', 'empty', () => {})
    expect(readFileSync(join(wt, '.env'), 'utf8')).toMatch(/^DB_DATABASE=".+ .+"$/m)
    expect(existsSync(dbOf(wt))).toBe(true)
  })
  it('makes a relative path absolute in the main checkout too', async () => {
    const { main } = project('DB_DATABASE=database/database.sqlite')
    await ensureDatabase(main)
    expect(dbOf(main)).toBe(join(main, 'database', 'database.sqlite'))
    expect(sqlitePath(main, ':memory:')).toBe(':memory:')
  })
})
