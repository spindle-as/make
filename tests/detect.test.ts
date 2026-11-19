import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectSetup, readmeCommands, seederDoesSomething } from '../src/main/detect'

function laravel(files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-detect-'))
  const all: Record<string, string> = {
    artisan: '',
    'composer.json': JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    'package.json': JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' } }),
    'package-lock.json': '{}',
    'database/migrations/.gitkeep': '',
    'storage/app/public/.gitignore': '',
    'config/filesystems.php': "<?php return ['links' => [public_path('storage') => storage_path('app/public')]];",
    ...files
  }
  for (const [f, body] of Object.entries(all)) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), body)
  }
  return dir
}

const SEEDER = (body: string) => `<?php\nnamespace Database\\Seeders;\nclass DatabaseSeeder extends Seeder\n{\n    public function run(): void\n    {\n${body}\n    }\n}\n`

describe('setup detection', () => {
  it('orders a Laravel app: install → build, migrate, seed, then storage link', () => {
    const dir = laravel({ 'database/seeders/DatabaseSeeder.php': SEEDER("        User::factory()->create(['email' => 'test@example.com']);") })
    const p = detectSetup(dir)
    expect(p.setup).toEqual(['composer install --no-interaction --prefer-dist --no-progress', 'npm ci --no-audit --no-fund', 'npm run build'])
    expect(p.migrate).toBe(true)
    expect(p.seed).toBe(true)
    expect(p.prepare).toEqual(['php artisan storage:link'])
  })

  it('follows composer.json’s setup script and skips what Spindle handles', () => {
    const dir = laravel({
      'composer.json': JSON.stringify({
        require: {},
        scripts: {
          setup: ['composer install', '@php -r "file_exists(\'.env\') || copy(\'.env.example\', \'.env\');"', '@php artisan key:generate', '@php artisan migrate --force --seed', 'npm install', 'npm run build', '@php artisan app:install-demo'],
          dev: ['npx concurrently ...']
        }
      })
    })
    const p = detectSetup(dir)
    expect(p.setup).not.toContainEqual(expect.stringMatching(/key:generate|\.env/))
    expect(p.seed).toBe(true)
    expect(p.prepare).toContain('php artisan app:install-demo')
    expect(p.reasons.join(' ')).toMatch(/setup/)
  })

  it('doesn’t seed when the seeder is empty, and adds Passport keys when needed', () => {
    const dir = laravel({
      'database/seeders/DatabaseSeeder.php': SEEDER('        // User::factory(10)->create();'),
      'composer.json': JSON.stringify({ require: { 'laravel/passport': '^12' } })
    })
    expect(seederDoesSomething(dir)).toBe(false)
    const p = detectSetup(dir)
    expect(p.seed).toBe(false)
    expect(p.prepare).toContain('[ -f storage/oauth-private.key ] || php artisan passport:keys')
  })

  it('suggests commands from README, Makefile and bin/setup without running them', () => {
    const dir = laravel({
      'README.md': '# App\n\n## Installation\n\n```bash\ncomposer install\ncp .env.example .env\nphp artisan migrate\n$ php artisan db:seed --class=DemoSeeder\nphp artisan serve\n```\n\n## Deploy\n```\nphp artisan deploy:prod\n```\n',
      Makefile: 'setup:\n\t./bin/setup\n',
      'bin/setup': '#!/bin/sh'
    })
    const p = detectSetup(dir)
    expect(p.suggestions.map((s) => s.command)).toEqual(['php artisan db:seed --class=DemoSeeder', 'make setup', './bin/setup'])
    expect(p.suggestions[0].source).toBe('README.md')
  })

  it('reads commands only from setup-like README sections', () => {
    expect(readmeCommands('## Getting started\n```\nnpm run seed:demo\n```\n## Usage\n```\nnpm run other\n```')).toEqual(['npm run seed:demo'])
  })

  it('handles a plain Node project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-detect-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    expect(detectSetup(dir)).toMatchObject({ setup: ['pnpm install'], prepare: [], migrate: false, seed: false })
  })
})
