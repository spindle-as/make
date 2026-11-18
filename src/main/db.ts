import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { DbDriver, DbService, FeatureDatabase } from '@shared/types'
import { exec, shell, shellQuote } from './exec'

// ---------- .env ----------

export function parseEnv(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}

export function readEnv(dir: string): Record<string, string> {
  const f = join(dir, '.env')
  return existsSync(f) ? parseEnv(readFileSync(f, 'utf8')) : {}
}

export interface DbConfig {
  driver: DbDriver
  host: string
  port: number
  user: string
  password: string
  database: string
}

export function configFromEnv(env: Record<string, string>): DbConfig | null {
  const c = (env.DB_CONNECTION || '').toLowerCase()
  const driver: DbDriver | null =
    c === 'mysql' ? 'mysql' : c === 'mariadb' ? 'mariadb' : c === 'pgsql' || c === 'postgres' ? 'pgsql' : c === 'sqlite' ? 'sqlite' : null
  if (!driver) return null
  return {
    driver,
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || (driver === 'pgsql' ? 5432 : 3306),
    user: env.DB_USERNAME || (driver === 'pgsql' ? 'postgres' : 'root'),
    password: env.DB_PASSWORD || '',
    database: env.DB_DATABASE || ''
  }
}

/** Database name for a feature: `<project>_<feature>`, safe for MySQL/Postgres identifiers. */
export function featureDbName(projectSlug: string, featureSlug: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${clean(projectSlug)}_${clean(featureSlug)}`.slice(0, 63).replace(/_+$/, '')
}

// ---------- DBngin ----------

const DBNGIN_PLIST = join(homedir(), 'Library/Application Support/com.tinyapp.DBngin/Data/DBEngines.plist')

export function dbnginInstalled(): boolean {
  return existsSync('/Applications/DBngin.app') || existsSync('/Users/Shared/DBngin')
}

export function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host })
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

export async function dbnginServices(): Promise<DbService[]> {
  if (!existsSync(DBNGIN_PLIST)) return []
  const r = await exec('plutil', ['-convert', 'json', '-o', '-', DBNGIN_PLIST])
  if (r.code !== 0) return []
  let raw: Record<string, unknown>[] = []
  try {
    raw = JSON.parse(r.stdout)
  } catch {
    return []
  }
  const services = raw
    .map((s): DbService | null => {
      const type = String(s.Type ?? '').toLowerCase()
      const kind = type === 'mysql' ? 'mysql' : type === 'mariadb' ? 'mariadb' : type === 'postgresql' ? 'pgsql' : type === 'redis' ? 'redis' : null
      if (!kind) return null
      return {
        id: String(s.ID ?? ''),
        name: String(s.Name ?? type),
        kind,
        version: String(s.Version ?? ''),
        port: Number(s.Port) || 0,
        binaries: String(s.Binaries ?? ''),
        running: false
      }
    })
    .filter((s): s is DbService => !!s)
  await Promise.all(services.map(async (s) => (s.running = s.port ? await isPortOpen(s.port) : false)))
  return services
}

/** Prefer the client binaries shipped with the DBngin service listening on this port. */
async function bin(cfg: DbConfig, tool: string): Promise<string> {
  const services = await dbnginServices()
  const wanted = cfg.driver === 'pgsql' ? ['pgsql'] : ['mysql', 'mariadb']
  const svc =
    services.find((s) => s.port === cfg.port && wanted.includes(s.kind) && s.running) ??
    services.find((s) => s.port === cfg.port && wanted.includes(s.kind))
  if (svc?.binaries) {
    const p = join(svc.binaries, 'bin', tool)
    if (existsSync(p)) return p
  }
  return tool
}

function mysqlArgs(cfg: DbConfig): string[] {
  return ['-h', cfg.host, '-P', String(cfg.port), '-u', cfg.user]
}

function pgArgs(cfg: DbConfig): string[] {
  return ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user]
}

const mysqlEnv = (cfg: DbConfig) => ({ MYSQL_PWD: cfg.password })
const pgEnv = (cfg: DbConfig) => ({ PGPASSWORD: cfg.password })

async function ensureReachable(cfg: DbConfig): Promise<void> {
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') return
  if (await isPortOpen(cfg.port)) return
  const svc = (await dbnginServices()).find((s) => s.port === cfg.port)
  throw new Error(
    svc
      ? `The DBngin service "${svc.name}" (${svc.kind} ${svc.version}, port ${cfg.port}) isn't running — start it in DBngin.`
      : `Nothing is listening on ${cfg.host}:${cfg.port}. Start your ${cfg.driver} server (e.g. in DBngin).`
  )
}

export type DbMode = 'empty' | 'clone'

/**
 * Give a worktree its own database and point its .env at it.
 * MySQL/MariaDB/Postgres: new database on the same server (optionally cloned from the main one).
 * SQLite: a separate database file inside the worktree.
 */
export async function provision(
  mainDir: string,
  worktree: string,
  name: string,
  mode: DbMode,
  log: (line: string) => void
): Promise<FeatureDatabase | null> {
  const cfg = configFromEnv(readEnv(worktree))
  if (!cfg) return null

  if (cfg.driver === 'sqlite') {
    const resolve = (base: string, p: string) => (p ? (isAbsolute(p) ? p : join(base, p)) : join(base, 'database', 'database.sqlite'))
    const source = resolve(mainDir, cfg.database)
    // A path pointing into the main checkout must be re-pointed at the worktree copy.
    const rel = cfg.database && isAbsolute(cfg.database) && cfg.database.startsWith(mainDir) ? relative(mainDir, cfg.database) : null
    const target = rel ? join(worktree, rel) : resolve(worktree, cfg.database && !isAbsolute(cfg.database) ? cfg.database : '')
    if (target === source) {
      log('! SQLite path is outside the project; leaving it shared')
      return null
    }
    mkdirSync(dirname(target), { recursive: true })
    if (mode === 'clone' && existsSync(source)) copyFileSync(source, target)
    else if (!existsSync(target)) writeFileSync(target, '')
    if (cfg.database) setEnvKey(worktree, 'DB_DATABASE', target)
    log(`✓ SQLite database ${mode === 'clone' && existsSync(source) ? 'copied' : 'created'} at ${relative(worktree, target)}`)
    return { driver: 'sqlite', name: target, created: true }
  }

  await ensureReachable(cfg)
  if (!cfg.database) throw new Error('DB_DATABASE is empty in .env')
  if (name === cfg.database) throw new Error('Refusing to reuse the main database name')

  if (cfg.driver === 'pgsql') {
    const createdb = await bin(cfg, 'createdb')
    const r = await exec(createdb, [...pgArgs(cfg), name], { env: pgEnv(cfg), timeoutMs: 60_000 })
    if (r.code !== 0 && !/already exists/.test(r.stderr)) throw new Error(`createdb failed: ${r.stderr.trim()}`)
    if (mode === 'clone') {
      const dump = await bin(cfg, 'pg_dump')
      const psql = await bin(cfg, 'psql')
      const a = pgArgs(cfg).map(shellQuote).join(' ')
      const c = await shell(
        `${shellQuote(dump)} ${a} --no-owner --no-acl ${shellQuote(cfg.database)} | ${shellQuote(psql)} ${a} -q -v ON_ERROR_STOP=0 ${shellQuote(name)}`,
        { env: pgEnv(cfg), timeoutMs: 15 * 60_000 }
      )
      if (c.code !== 0) throw new Error(`Cloning ${cfg.database} failed: ${c.stderr.trim().split('\n').slice(-3).join(' ')}`)
    }
  } else {
    const mysql = await bin(cfg, 'mysql')
    const r = await exec(mysql, [...mysqlArgs(cfg), '-e', `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`], {
      env: mysqlEnv(cfg),
      timeoutMs: 60_000
    })
    if (r.code !== 0) throw new Error(`Creating database failed: ${r.stderr.trim()}`)
    if (mode === 'clone') {
      const dump = await bin(cfg, 'mysqldump')
      const a = mysqlArgs(cfg).map(shellQuote).join(' ')
      const c = await shell(
        `${shellQuote(dump)} ${a} --single-transaction --routines --triggers --no-tablespaces ${shellQuote(cfg.database)} | ${shellQuote(mysql)} ${a} ${shellQuote(name)}`,
        { env: mysqlEnv(cfg), timeoutMs: 15 * 60_000 }
      )
      if (c.code !== 0) throw new Error(`Cloning ${cfg.database} failed: ${c.stderr.trim().split('\n').slice(-3).join(' ')}`)
    }
  }
  setEnvKey(worktree, 'DB_DATABASE', name)
  log(`✓ Database ${name} ${mode === 'clone' ? `cloned from ${cfg.database}` : 'created'} (${cfg.driver} on port ${cfg.port})`)
  return { driver: cfg.driver, name, host: cfg.host, port: cfg.port, user: cfg.user, source: cfg.database, created: true }
}

/** Drop a database this app created. Credentials are re-read from the main checkout's .env. */
export async function drop(mainDir: string, db: FeatureDatabase): Promise<void> {
  if (!db.created || db.driver === 'sqlite') return // sqlite file goes away with the worktree
  const base = configFromEnv(readEnv(mainDir))
  if (!base) throw new Error('Cannot read database credentials from the main checkout .env')
  if (db.name === base.database || db.name === db.source) throw new Error(`Refusing to drop ${db.name}: it is the main database`)
  const cfg: DbConfig = { ...base, host: db.host ?? base.host, port: db.port ?? base.port, user: db.user ?? base.user }
  await ensureReachable(cfg)
  if (db.driver === 'pgsql') {
    const dropdb = await bin(cfg, 'dropdb')
    const r = await exec(dropdb, [...pgArgs(cfg), '--if-exists', '--force', db.name], { env: pgEnv(cfg), timeoutMs: 60_000 })
    if (r.code !== 0) throw new Error(`dropdb failed: ${r.stderr.trim()}`)
  } else {
    const mysql = await bin(cfg, 'mysql')
    const r = await exec(mysql, [...mysqlArgs(cfg), '-e', `DROP DATABASE IF EXISTS \`${db.name}\``], { env: mysqlEnv(cfg), timeoutMs: 60_000 })
    if (r.code !== 0) throw new Error(`Dropping database failed: ${r.stderr.trim()}`)
  }
}

function setEnvKey(dir: string, key: string, value: string): void {
  const f = join(dir, '.env')
  if (!existsSync(f)) return
  const body = readFileSync(f, 'utf8')
  const re = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  writeFileSync(f, re.test(body) ? body.replace(re, () => line) : body.replace(/\n?$/, `\n${line}\n`))
}

/** Describe the main checkout's database for project settings. */
export function describeProjectDb(mainDir: string): { driver: DbDriver; database: string; port?: number } | null {
  const cfg = configFromEnv(readEnv(mainDir))
  if (!cfg) return null
  return { driver: cfg.driver, database: cfg.database || (cfg.driver === 'sqlite' ? 'database/database.sqlite' : ''), port: cfg.driver === 'sqlite' ? undefined : cfg.port }
}

/** Make sure the database named in .env exists (first-time project setup). Returns true if it was created. */
export async function ensureDatabase(dir: string): Promise<{ created: boolean; driver: DbDriver } | null> {
  const cfg = configFromEnv(readEnv(dir))
  if (!cfg) return null
  if (cfg.driver === 'sqlite') {
    const file = cfg.database ? (isAbsolute(cfg.database) ? cfg.database : join(dir, cfg.database)) : join(dir, 'database', 'database.sqlite')
    if (existsSync(file)) return { created: false, driver: 'sqlite' }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '')
    return { created: true, driver: 'sqlite' }
  }
  await ensureReachable(cfg)
  if (!cfg.database) throw new Error('DB_DATABASE is empty in .env')
  if (cfg.driver === 'pgsql') {
    const r = await exec(await bin(cfg, 'createdb'), [...pgArgs(cfg), cfg.database], { env: pgEnv(cfg), timeoutMs: 60_000 })
    if (r.code === 0) return { created: true, driver: 'pgsql' }
    if (/already exists/.test(r.stderr)) return { created: false, driver: 'pgsql' }
    throw new Error(r.stderr.trim())
  }
  const mysql = await bin(cfg, 'mysql')
  const exists = await exec(mysql, [...mysqlArgs(cfg), '-N', '-e', `SHOW DATABASES LIKE '${cfg.database.replace(/'/g, '')}'`], { env: mysqlEnv(cfg), timeoutMs: 30_000 })
  if (exists.code !== 0) throw new Error(exists.stderr.trim())
  if (exists.stdout.trim()) return { created: false, driver: cfg.driver }
  const r = await exec(mysql, [...mysqlArgs(cfg), '-e', `CREATE DATABASE \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`], { env: mysqlEnv(cfg), timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error(r.stderr.trim())
  return { created: true, driver: cfg.driver }
}

/** Point a workspace's mail at Spindle's catcher, tagged so it files under the right thread. */
export function captureMailEnv(dir: string, port: number, tag: string): boolean {
  const f = join(dir, '.env')
  if (!existsSync(f)) return false
  for (const [k, v] of [
    ['MAIL_MAILER', 'smtp'],
    ['MAIL_HOST', '127.0.0.1'],
    ['MAIL_PORT', String(port)],
    ['MAIL_USERNAME', tag],
    ['MAIL_PASSWORD', 'spindle'],
    ['MAIL_ENCRYPTION', 'null'],
    ['MAIL_SCHEME', 'smtp']
  ]) setEnvKey(dir, k, v)
  return true
}
