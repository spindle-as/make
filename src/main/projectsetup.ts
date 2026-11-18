import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, ProjectSetupState } from '@shared/types'
import { captureMailEnv, ensureDatabase, readEnv } from './db'
import { exec, shell } from './exec'
import * as herd from './herd'

type Step = ProjectSetupState['steps'][number]

export const SETUP_STEPS: Pick<Step, 'id' | 'label'>[] = [
  { id: 'deps', label: 'Installing dependencies' },
  { id: 'env', label: 'Preparing your project' },
  { id: 'db', label: 'Setting up your database' },
  { id: 'migrate', label: 'Preparing your data' },
  { id: 'assets', label: 'Building the interface' },
  { id: 'site', label: 'Starting your application' }
]

export function freshSetup(): ProjectSetupState {
  return { status: 'running', steps: SETUP_STEPS.map((s) => ({ ...s, status: 'pending' })), log: '', updatedAt: Date.now() }
}

const pkg = (dir: string): { scripts?: Record<string, string> } | null => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Get a freshly opened project running: dependencies, .env, database, migrations,
 * assets and a local site. Steps that already succeeded are skipped on a retry.
 */
export async function runSetup(
  project: Project,
  state: ProjectSetupState,
  opts: { mailPort: number; capture: boolean; env?: Record<string, string>; php?: string; site?: () => Promise<string | false> },
  update: (s: ProjectSetupState, patch?: Partial<Project>) => void
): Promise<ProjectSetupState> {
  const dir = project.path
  const s: ProjectSetupState = { ...state, status: 'running', error: undefined, steps: state.steps.map((x) => ({ ...x })) }
  const log = (t: string) => {
    s.log = (s.log + (t.endsWith('\n') ? t : t + '\n')).slice(-80_000)
    s.updatedAt = Date.now()
    update(s)
  }
  const sh = async (cmd: string) => {
    log(`$ ${cmd}`)
    const r = await shell(cmd, { cwd: dir, timeoutMs: 20 * 60_000, env: { ...opts.env, CI: '1', COMPOSER_NO_INTERACTION: '1' } })
    log(r.stdout + r.stderr)
    if (r.code !== 0) throw new Error(`${cmd} failed (exit ${r.code})`)
  }
  const laravel = existsSync(join(dir, 'artisan'))
  const p = pkg(dir)

  const steps: Record<string, () => Promise<string | false>> = {
    deps: async () => {
      let did = false
      if (existsSync(join(dir, 'composer.json')) && !existsSync(join(dir, 'vendor', 'autoload.php'))) {
        await sh('composer install --no-interaction --prefer-dist --no-progress')
        did = true
      }
      if (p && !existsSync(join(dir, 'node_modules'))) {
        await sh(existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm install' : existsSync(join(dir, 'package-lock.json')) ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund')
        did = true
      }
      return did ? 'Installed' : false
    },
    env: async () => {
      if (!laravel) return false
      let created = false
      if (!existsSync(join(dir, '.env')) && existsSync(join(dir, '.env.example'))) {
        copyFileSync(join(dir, '.env.example'), join(dir, '.env'))
        created = true
      }
      if (!readEnv(dir).APP_KEY) await sh('php artisan key:generate --force')
      // Only touch mail for a .env we created: an existing project's settings stay as they are.
      if (created && opts.capture) captureMailEnv(dir, opts.mailPort, `project:${project.id}`)
      return created ? 'Created your project settings' : 'Settings ready'
    },
    db: async () => {
      if (!laravel) return false
      const r = await ensureDatabase(dir)
      if (!r) return false
      return r.created ? `Created a ${r.driver === 'sqlite' ? 'SQLite' : r.driver} database` : 'Database ready'
    },
    migrate: async () => {
      if (!laravel) return false
      const status = await exec('php', ['artisan', 'migrate:status', '--no-ansi'], { cwd: dir, env: opts.env, timeoutMs: 120_000 })
      const fresh = status.code !== 0 || /not found|No migrations/i.test(status.stdout + status.stderr) || !/Ran\b|\[\d+\]|Batch/i.test(status.stdout)
      const seeder = existsSync(join(dir, 'database', 'seeders', 'DatabaseSeeder.php'))
      await sh(`php artisan migrate --force${fresh && seeder ? ' --seed' : ''}`)
      return fresh && seeder ? 'Database structure created and filled with sample data' : 'Database structure up to date'
    },
    assets: async () => {
      if (!p?.scripts?.build) return false
      if (existsSync(join(dir, 'public', 'build', 'manifest.json'))) return 'Already built'
      await sh('npm run build')
      return 'Built'
    },
    site: async () => {
      if (project.server !== 'herd') return opts.site ? opts.site() : false
      if (!laravel || !(await herd.available())) return false
      const existing = (await herd.sites()).find((x) => x.path === dir)
      if (existing) {
        update(s, { localUrl: existing.url })
        return existing.url
      }
      const url = await herd.link(dir, project.slug, true, opts.php)
      update(s, { localUrl: url })
      return url
    }
  }

  for (const step of s.steps) {
    if (step.status === 'done' || step.status === 'skipped') continue
    step.status = 'running'
    update(s)
    try {
      const result = await steps[step.id]()
      step.status = result === false ? 'skipped' : 'done'
      step.detail = result === false ? undefined : result
      update(s)
    } catch (e) {
      step.status = 'failed'
      step.detail = (e as Error).message
      s.status = 'failed'
      s.error = (e as Error).message
      update(s)
      return s
    }
  }
  s.status = 'done'
  update(s)
  return s
}
