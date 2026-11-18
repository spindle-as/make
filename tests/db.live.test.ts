// Opt-in: creates and drops sf_livetest_* databases on a local MySQL.
// SF_LIVE_DB=1 SF_DB_PORT=3308 npx vitest run tests/db.live.test.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dbnginServices, drop, provision } from '../src/main/db'

const live = process.env.SF_LIVE_DB === '1'
const port = Number(process.env.SF_DB_PORT || 3306)
const MAIN = `sf_livetest_main_${Date.now().toString(36)}`
const FEATURE = `${MAIN}_feat`

describe.skipIf(!live)('per-feature MySQL database (live)', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-dblive-'))
  let mysql = 'mysql'
  const q = (sql: string, db?: string) =>
    execFileSync(mysql, ['-h', '127.0.0.1', '-P', String(port), '-u', 'root', '-N', '-e', sql, ...(db ? [db] : [])], { encoding: 'utf8' }).trim()

  afterAll(() => {
    try {
      q(`DROP DATABASE IF EXISTS \`${MAIN}\`; DROP DATABASE IF EXISTS \`${FEATURE}\``)
    } catch {
      /* ignore */
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('clones the main database into a feature database and drops it again', async () => {
    const svc = (await dbnginServices()).find((s) => s.port === port && s.running)
    if (svc) mysql = join(svc.binaries, 'bin', 'mysql')
    q(`CREATE DATABASE \`${MAIN}\`; CREATE TABLE \`${MAIN}\`.users (id int primary key, name varchar(50)); INSERT INTO \`${MAIN}\`.users VALUES (1,'ada'),(2,'linus')`)

    const main = join(root, 'main')
    const wt = join(root, 'wt')
    mkdirSync(main)
    mkdirSync(wt)
    const env = `DB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_PORT=${port}\nDB_DATABASE=${MAIN}\nDB_USERNAME=root\nDB_PASSWORD=\n`
    writeFileSync(join(main, '.env'), env)
    writeFileSync(join(wt, '.env'), env)

    const lines: string[] = []
    const created = await provision(main, wt, FEATURE, 'clone', (l) => lines.push(l))
    expect(created).toMatchObject({ driver: 'mysql', name: FEATURE, created: true, source: MAIN })
    expect(q('SELECT COUNT(*) FROM users', FEATURE)).toBe('2')
    expect(readFileSync(join(wt, '.env'), 'utf8')).toContain(`DB_DATABASE=${FEATURE}`)
    // the main database is untouched
    expect(readFileSync(join(main, '.env'), 'utf8')).toContain(`DB_DATABASE=${MAIN}`)

    // refuses to drop the main database even if asked
    await expect(drop(main, { ...created!, name: MAIN })).rejects.toThrow(/Refusing/)

    await drop(main, created!)
    expect(q(`SHOW DATABASES LIKE '${FEATURE}'`)).toBe('')
    expect(q(`SHOW DATABASES LIKE '${MAIN}'`)).toBe(MAIN)
    expect(existsSync(join(wt, '.env'))).toBe(true)
  }, 120_000)
})
