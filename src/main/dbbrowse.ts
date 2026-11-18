import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DbDriver, DbSnapshot, DbTable, QueryResult } from '@shared/types'
import { uid } from '@shared/util'
import { configFromEnv, dbnginServices, readEnv, type DbConfig } from './db'
import { exec, shell, shellQuote } from './exec'

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1'])
const MAX_ROWS = 500

/** Resolve the database a workspace uses — and refuse anything that isn't local. */
export function workspaceDb(dir: string): DbConfig & { file?: string } {
  const cfg = configFromEnv(readEnv(dir))
  if (!cfg) throw new Error('No database is configured for this project (.env has no DB_CONNECTION).')
  if (cfg.driver === 'sqlite') {
    const file = cfg.database ? (cfg.database.startsWith('/') ? cfg.database : join(dir, cfg.database)) : join(dir, 'database', 'database.sqlite')
    return { ...cfg, file }
  }
  if (!LOCAL.has(cfg.host)) throw new Error(`Refusing to open ${cfg.host}: Spindle only browses local development databases.`)
  return cfg
}

async function tool(cfg: DbConfig, name: string): Promise<string> {
  const services = await dbnginServices()
  const kinds = cfg.driver === 'pgsql' ? ['pgsql'] : ['mysql', 'mariadb']
  const svc = services.find((s) => s.port === cfg.port && kinds.includes(s.kind))
  const p = svc ? join(svc.binaries, 'bin', name) : ''
  return p && existsSync(p) ? p : name
}

/** Parse tab-separated CLI output with a header row. */
export function parseTsv(out: string, nullToken: string | null): { columns: string[]; rows: (string | null)[][] } {
  const lines = out.replace(/\n$/, '').split('\n')
  if (!lines[0]) return { columns: [], rows: [] }
  const columns = lines[0].split('\t')
  const unescape = (v: string) => v.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
  const rows = lines.slice(1).map((l) => l.split('\t').map((v) => (nullToken !== null && v === nullToken ? null : unescape(v))))
  return { columns, rows }
}

async function run(cfg: DbConfig & { file?: string }, sql: string): Promise<QueryResult> {
  const t0 = Date.now()
  let r
  if (cfg.driver === 'sqlite') {
    r = await exec('sqlite3', ['-header', '-separator', '\t', '-nullvalue', '\u2400NULL\u2400', cfg.file!, sql], { timeoutMs: 30_000 })
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Query failed')
    const { columns, rows } = parseTsv(r.stdout, '\u2400NULL\u2400')
    return { columns, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, ms: Date.now() - t0 }
  }
  if (cfg.driver === 'pgsql') {
    r = await exec(await tool(cfg, 'psql'), ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', cfg.database, '-A', '-F', '\t', '-P', 'footer=off', '-P', 'null=\u2400NULL\u2400', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env: { PGPASSWORD: cfg.password },
      timeoutMs: 30_000
    })
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Query failed')
    const { columns, rows } = parseTsv(r.stdout, '\u2400NULL\u2400')
    return { columns, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, ms: Date.now() - t0 }
  }
  r = await exec(await tool(cfg, 'mysql'), ['-h', cfg.host, '-P', String(cfg.port), '-u', cfg.user, '--batch', '-e', sql, cfg.database], {
    env: { MYSQL_PWD: cfg.password },
    timeoutMs: 30_000
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'Query failed')
  const { columns, rows } = parseTsv(r.stdout, 'NULL')
  return { columns, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, ms: Date.now() - t0 }
}

const READ_ONLY = /^\s*(select|show|explain|describe|desc|with|pragma)\b/i

/** One statement, read-only unless the caller explicitly allows writes. */
export function checkSql(sql: string, allowWrite: boolean): string {
  const s = sql.trim().replace(/;\s*$/, '')
  if (!s) throw new Error('Enter a query')
  if (/;\s*\S/.test(s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""'))) throw new Error('Run one statement at a time.')
  if (!allowWrite && !READ_ONLY.test(s)) throw new Error('This query changes data. Turn on “Allow changes” to run it.')
  if (/^\s*with\b/i.test(s) && !allowWrite && /\b(insert|update|delete)\b/i.test(s)) throw new Error('This query changes data. Turn on “Allow changes” to run it.')
  return s
}

export async function tables(dir: string): Promise<{ driver: DbDriver; database: string; tables: DbTable[] }> {
  const cfg = workspaceDb(dir)
  if (cfg.driver === 'sqlite' && !existsSync(cfg.file!)) return { driver: 'sqlite', database: cfg.file!, tables: [] }
  const sql =
    cfg.driver === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      : cfg.driver === 'pgsql'
        ? 'SELECT relname AS name, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY relname'
        : 'SELECT table_name AS name, table_rows AS `rows` FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'
  const r = await run(cfg, sql)
  return {
    driver: cfg.driver,
    database: cfg.driver === 'sqlite' ? cfg.file! : cfg.database,
    tables: r.rows.map((row) => ({ name: row[0] ?? '', rows: row[1] != null ? Number(row[1]) : undefined }))
  }
}

export async function rows(dir: string, table: string, page: number, pageSize = 100): Promise<QueryResult> {
  const known = (await tables(dir)).tables.map((t) => t.name)
  if (!known.includes(table)) throw new Error(`Unknown table ${table}`)
  const cfg = workspaceDb(dir)
  const q = cfg.driver === 'mysql' || cfg.driver === 'mariadb' ? `\`${table}\`` : `"${table}"`
  const r = await run(cfg, `SELECT * FROM ${q} LIMIT ${pageSize} OFFSET ${Math.max(0, page) * pageSize}`)
  if (r.columns.length) return r
  // Empty result: CLIs print no header, so look the columns up separately.
  const cols =
    cfg.driver === 'sqlite'
      ? `SELECT name FROM pragma_table_info('${table}')`
      : cfg.driver === 'pgsql'
        ? `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`
        : `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' ORDER BY ordinal_position`
  const c = await run(cfg, cols)
  return { ...r, columns: c.rows.map((x) => x[0] ?? '') }
}

export async function query(dir: string, sql: string, allowWrite: boolean): Promise<QueryResult> {
  return run(workspaceDb(dir), checkSql(sql, allowWrite))
}

// ---------------- snapshots ----------------

export function listSnapshots(snapDir: string, featureId: string): DbSnapshot[] {
  const d = join(snapDir, featureId)
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter((f) => /\.(sql|sqlite)$/.test(f))
    .map((f) => {
      const [id, ts, ...label] = f.replace(/\.(sql|sqlite)$/, '').split('__')
      return { id, featureId, at: Number(ts), label: decodeURIComponent(label.join('__') || 'Snapshot'), size: statSync(join(d, f)).size }
    })
    .sort((a, b) => b.at - a.at)
}

function snapFile(snapDir: string, featureId: string, id: string): string | undefined {
  const d = join(snapDir, featureId)
  return existsSync(d) ? readdirSync(d).map((f) => join(d, f)).find((f) => f.includes(`/${id}__`)) : undefined
}

export async function snapshot(dir: string, snapDir: string, featureId: string, label: string): Promise<DbSnapshot> {
  const cfg = workspaceDb(dir)
  const id = uid('s_')
  const d = join(snapDir, featureId)
  mkdirSync(d, { recursive: true })
  const base = join(d, `${id}__${Date.now()}__${encodeURIComponent(label || 'Snapshot')}`)
  if (cfg.driver === 'sqlite') {
    if (!existsSync(cfg.file!)) throw new Error('The database file does not exist yet.')
    copyFileSync(cfg.file!, base + '.sqlite')
  } else {
    const file = base + '.sql'
    const dump =
      cfg.driver === 'pgsql'
        ? `${shellQuote(await tool(cfg, 'pg_dump'))} -h ${shellQuote(cfg.host)} -p ${cfg.port} -U ${shellQuote(cfg.user)} --clean --if-exists --no-owner ${shellQuote(cfg.database)} > ${shellQuote(file)}`
        : `${shellQuote(await tool(cfg, 'mysqldump'))} -h ${shellQuote(cfg.host)} -P ${cfg.port} -u ${shellQuote(cfg.user)} --single-transaction --routines --triggers --no-tablespaces ${shellQuote(cfg.database)} > ${shellQuote(file)}`
    const r = await shell(dump, { env: cfg.driver === 'pgsql' ? { PGPASSWORD: cfg.password } : { MYSQL_PWD: cfg.password }, timeoutMs: 10 * 60_000 })
    if (r.code !== 0) {
      if (existsSync(file)) unlinkSync(file)
      throw new Error(r.stderr.trim() || 'Snapshot failed')
    }
  }
  return listSnapshots(snapDir, featureId).find((s) => s.id === id)!
}

export async function restore(dir: string, snapDir: string, featureId: string, id: string): Promise<void> {
  const cfg = workspaceDb(dir)
  const file = snapFile(snapDir, featureId, id)
  if (!file) throw new Error('Snapshot not found')
  if (cfg.driver === 'sqlite') {
    copyFileSync(file, cfg.file!)
    return
  }
  const load =
    cfg.driver === 'pgsql'
      ? `${shellQuote(await tool(cfg, 'psql'))} -h ${shellQuote(cfg.host)} -p ${cfg.port} -U ${shellQuote(cfg.user)} -q -d ${shellQuote(cfg.database)} < ${shellQuote(file)}`
      : `${shellQuote(await tool(cfg, 'mysql'))} -h ${shellQuote(cfg.host)} -P ${cfg.port} -u ${shellQuote(cfg.user)} ${shellQuote(cfg.database)} < ${shellQuote(file)}`
  const r = await shell(load, { env: cfg.driver === 'pgsql' ? { PGPASSWORD: cfg.password } : { MYSQL_PWD: cfg.password }, timeoutMs: 10 * 60_000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'Restore failed')
}
