import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Works out how a project gets ready to run, from what's in it — so a new worktree (or a freshly
 * opened project) runs the right things in the right order:
 *
 *   setup    install dependencies and build (before the database matters)
 *   migrate  run migrations on the change's own database
 *   seed     fill a brand-new database with sample data
 *   prepare  things that need the app + database ready (storage link, keys, custom seeders)
 *
 * Sources, most explicit first: composer.json's "setup" script (Laravel 12 starters), the
 * seeders, filesystem links, known packages, then hints from README / Makefile / bin/setup that
 * are suggested rather than run.
 */

export interface SetupPlan {
  setup: string[]
  prepare: string[]
  migrate: boolean
  seed: boolean
  /** commands found in docs or scripts, offered for the user to add */
  suggestions: { command: string; source: string }[]
  /** why things were chosen, for the UI */
  reasons: string[]
}

const read = (f: string): string => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}
const json = <T>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T
  } catch {
    return null
  }
}

function runner(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

export function installCommand(root: string): string {
  const r = runner(root)
  if (r === 'npm') return existsSync(join(root, 'package-lock.json')) ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund --no-package-lock'
  return `${r} install`
}

/** Things Spindle already does itself, or that would block (servers, watchers). */
const HANDLED = [
  /\.env\.example|copy\(|cp \.env/, // Spindle copies/creates .env
  /artisan\s+key:generate/, // the copied .env has the key; new projects get one in project setup
  /artisan\s+serve\b|npm run dev\b|pnpm( run)? dev\b|yarn dev\b|artisan\s+(queue:work|horizon|schedule:work|reverb:start|pail)\b|composer (run )?dev\b|npx concurrently/,
  /^git /
]
const isInstall = (c: string) => /^(composer install|npm (ci|install)|pnpm install|yarn( install)?$|bun install)\b/.test(c)
const isBuild = (c: string) => /^(npm|pnpm|yarn|bun) run build\b/.test(c)

/** A seeder that actually seeds something (Laravel's default creates a test user — that counts). */
export function seederDoesSomething(root: string): boolean {
  const src = read(join(root, 'database', 'seeders', 'DatabaseSeeder.php'))
  const run = src.match(/function\s+run\s*\([^)]*\)[^{]*\{([\s\S]*)\}\s*\}\s*$/)?.[1] ?? ''
  return /->call\(|::factory\(|->create\(|::create\(|DB::table\(|->insert\(|::seed\(/.test(run.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))
}

/** Commands from the Setup/Installation part of a README (code blocks only). */
export function readmeCommands(md: string): string[] {
  const out: string[] = []
  const sections = md.split(/^#{1,4}\s+/m)
  for (const sec of sections) {
    const title = sec.split('\n')[0].toLowerCase()
    if (!/install|setup|set up|getting started|local|development|quick ?start|running/.test(title)) continue
    for (const block of sec.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)) {
      for (const raw of block[1].split('\n')) {
        const line = raw.replace(/^\s*\$\s*/, '').trim()
        if (/^(php artisan|composer|npm|pnpm|yarn|bun|make|\.\/|bin\/|sail )/.test(line)) out.push(line)
      }
    }
  }
  return [...new Set(out)]
}

export function detectSetup(root: string): SetupPlan {
  const laravel = existsSync(join(root, 'artisan'))
  const composer = json<{ require?: Record<string, string>; scripts?: Record<string, string | string[]> }>(join(root, 'composer.json'))
  const pkg = json<{ scripts?: Record<string, string> }>(join(root, 'package.json'))
  const plan: SetupPlan = { setup: [], prepare: [], migrate: false, seed: false, suggestions: [], reasons: [] }
  const add = (list: string[], c: string) => {
    if (!list.includes(c)) list.push(c)
  }

  // 1. Dependencies and build.
  if (composer) add(plan.setup, 'composer install --no-interaction --prefer-dist --no-progress')
  if (pkg) {
    add(plan.setup, installCommand(root))
    if (pkg.scripts?.build && (laravel || existsSync(join(root, 'vite.config.js')) || existsSync(join(root, 'vite.config.ts')))) add(plan.setup, `${runner(root)} run build`)
  }

  // 2. composer.json "setup" script (Laravel 12): the project's own recipe.
  const script = composer?.scripts?.setup
  if (script) {
    const steps = (Array.isArray(script) ? script : [script]).map((c) => c.replace(/^@php\s+/, 'php ').replace(/^@composer\s+/, 'composer ').trim())
    plan.reasons.push('Follows composer.json’s “setup” script.')
    for (const c of steps) {
      if (HANDLED.some((re) => re.test(c)) || c.startsWith('@')) continue
      if (/artisan\s+migrate/.test(c)) {
        plan.migrate = true
        if (/--seed/.test(c)) plan.seed = true
      } else if (/artisan\s+db:seed/.test(c)) plan.seed = true
      else if (isInstall(c)) add(plan.setup, c.startsWith('composer install') ? 'composer install --no-interaction --prefer-dist --no-progress' : installCommand(root))
      else if (isBuild(c)) add(plan.setup, c)
      else add(plan.prepare, c)
    }
  }

  // 3. Laravel specifics.
  if (laravel) {
    if (existsSync(join(root, 'database', 'migrations'))) {
      plan.migrate = true
      plan.reasons.push('Runs migrations on each change’s own database.')
    }
    if (seederDoesSomething(root)) {
      plan.seed = true
      plan.reasons.push('Seeds new databases — DatabaseSeeder creates sample data.')
    }
    const fs = read(join(root, 'config', 'filesystems.php'))
    if ((/public_path\(\s*['"]storage['"]\s*\)/.test(fs) || !fs) && existsSync(join(root, 'storage', 'app', 'public'))) {
      add(plan.prepare, 'php artisan storage:link')
      plan.reasons.push('Links public/storage so uploaded files show up.')
    }
    if (composer?.require?.['laravel/passport']) {
      add(plan.prepare, '[ -f storage/oauth-private.key ] || php artisan passport:keys')
      plan.reasons.push('Creates Passport keys (they aren’t in git).')
    }
  }

  // 4. Hints to offer, not run: README, Makefile, bin/setup.
  const covered = (c: string) => HANDLED.some((re) => re.test(c)) || isInstall(c) || isBuild(c) || /artisan\s+migrate\b/.test(c) || /artisan\s+db:seed\s*(--force)?\s*$/.test(c) || [...plan.setup, ...plan.prepare].includes(c)
  for (const f of ['README.md', 'readme.md', 'README.MD', 'docs/setup.md', 'CONTRIBUTING.md']) {
    for (const c of readmeCommands(read(join(root, f)))) if (!covered(c)) plan.suggestions.push({ command: c, source: f })
  }
  const make = read(join(root, 'Makefile'))
  for (const t of ['setup', 'install', 'bootstrap', 'init']) if (new RegExp(`^${t}:`, 'm').test(make)) plan.suggestions.push({ command: `make ${t}`, source: 'Makefile' })
  for (const f of ['bin/setup', 'scripts/setup.sh', 'setup.sh']) if (existsSync(join(root, f))) plan.suggestions.push({ command: `./${f}`, source: f })
  if (pkg?.scripts?.setup) plan.suggestions.push({ command: `${runner(root)} run setup`, source: 'package.json' })
  const seen = new Set<string>()
  plan.suggestions = plan.suggestions.filter((s) => (seen.has(s.command) ? false : (seen.add(s.command), true))).slice(0, 12)
  return plan
}

/** Files worth showing an AI that's asked how the project runs. */
export function setupContextFiles(root: string): string[] {
  const candidates = ['composer.json', 'package.json', 'README.md', 'Makefile', '.env.example', 'phpunit.xml', 'docker-compose.yml', 'Procfile', 'bin/setup', 'CLAUDE.md', 'AGENTS.md']
  const seeders = existsSync(join(root, 'database', 'seeders')) ? readdirSync(join(root, 'database', 'seeders')).map((f) => `database/seeders/${f}`) : []
  return [...candidates, ...seeders.slice(0, 5)].filter((f) => existsSync(join(root, f)))
}
