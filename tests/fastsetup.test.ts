import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as fast from '../src/main/fastsetup'

const tmp = () => mkdtempSync(join(tmpdir(), 'sf-fast-'))

describe('fast setup plan', () => {
  it('runs installs together, builds after JS packages, keeps the order of everything else', () => {
    const plan = fast.planSetup(['cp .env.example .env', 'composer install --no-interaction', 'npm ci --no-audit', 'npm run build', 'php artisan key:generate'])
    expect(plan.before).toEqual(['cp .env.example .env'])
    expect(plan.installs).toEqual(['composer install --no-interaction', 'npm ci --no-audit'])
    expect(plan.builds).toEqual(['npm run build'])
    expect(plan.after).toEqual(['php artisan key:generate'])
  })
  it('knows which folder and lockfile each install command uses', () => {
    expect(fast.installKind('composer install')).toMatchObject({ dir: 'vendor', lock: 'composer.lock' })
    expect(fast.installKind('npm ci --no-audit')).toMatchObject({ dir: 'node_modules', lock: 'package-lock.json' })
    expect(fast.installKind('pnpm install')).toMatchObject({ lock: 'pnpm-lock.yaml' })
    expect(fast.installKind('yarn')).toMatchObject({ lock: 'yarn.lock' })
    expect(fast.installKind('npm run build')).toBeNull()
    expect(fast.isBuildCommand('pnpm run build')).toBe(true)
  })
})

describe('reusing installed dependencies', () => {
  const kind = fast.installKind('composer install')!
  it('reuses vendor/ only when it holds exactly the locked versions', () => {
    const main = tmp()
    const wt = tmp()
    const lock = { packages: [{ name: 'a/a', version: '1.0.0' }], 'packages-dev': [{ name: 'b/b', version: '2.0.0' }] }
    mkdirSync(join(main, 'vendor', 'composer'), { recursive: true })
    writeFileSync(join(main, 'vendor', 'composer', 'installed.json'), JSON.stringify({ packages: [{ name: 'b/b', version: '2.0.0' }, { name: 'a/a', version: '1.0.0' }] }))
    writeFileSync(join(wt, 'composer.lock'), JSON.stringify(lock))
    expect(fast.depsMatchLock(kind, main, wt)).toBe(true)
    writeFileSync(join(wt, 'composer.lock'), JSON.stringify({ ...lock, packages: [{ name: 'a/a', version: '1.1.0' }] }))
    expect(fast.depsMatchLock(kind, main, wt)).toBe(false)
  })
  it('checks node_modules against npm’s own record, ignoring optional platform packages', () => {
    const main = tmp()
    const wt = tmp()
    const npm = fast.installKind('npm ci')!
    writeFileSync(
      join(wt, 'package-lock.json'),
      JSON.stringify({ packages: { '': {}, 'node_modules/vite': { version: '8.0.0' }, 'node_modules/@rollup/rollup-linux-x64': { version: '4.0.0', optional: true } } })
    )
    mkdirSync(join(main, 'node_modules'), { recursive: true })
    writeFileSync(join(main, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: { 'node_modules/vite': { version: '8.0.0' } } }))
    expect(fast.depsMatchLock(npm, main, wt)).toBe(true)
    writeFileSync(join(main, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: { 'node_modules/vite': { version: '7.0.0' } } }))
    expect(fast.depsMatchLock(npm, main, wt)).toBe(false)
  })
})

describe('copy-on-write cache', () => {
  it('stores a folder and hands it back for cloning', async () => {
    const src = tmp()
    mkdirSync(join(src, 'pkg'), { recursive: true })
    writeFileSync(join(src, 'pkg', 'index.js'), 'ok')
    const cache = new fast.SetupCache(tmp())
    expect(cache.get('p1', 'node_modules', 'abc')).toBeNull()
    await cache.put('p1', 'node_modules', 'abc', src)
    const hit = cache.get('p1', 'node_modules', 'abc')!
    const dst = join(tmp(), 'node_modules')
    expect(await fast.cloneDir(hit, dst)).toBeTruthy()
    expect(readFileSync(join(dst, 'pkg', 'index.js'), 'utf8')).toBe('ok')
    expect(await fast.cloneDir(hit, dst)).toBe(false) // never over an existing folder
  })

  it('keys builds by the committed build inputs', async () => {
    const dir = tmp()
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
    git('init', '-q')
    mkdirSync(join(dir, 'resources'))
    writeFileSync(join(dir, 'resources', 'app.css'), 'a')
    writeFileSync(join(dir, 'package.json'), '{}')
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    const k1 = await fast.buildKey(dir)
    expect(k1).toMatch(/^[0-9a-f]{16}$/)
    writeFileSync(join(dir, 'resources', 'app.css'), 'b')
    expect(await fast.buildKey(dir)).toBeNull() // uncommitted edits: no reuse
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'b')
    expect(await fast.buildKey(dir)).not.toBe(k1)
  })

  it('bundles the same helper source the app builds at runtime', async () => {
    const script = '../scripts/build-helpers.mjs'
    const { CLONEDIR_SOURCE } = (await import(/* @vite-ignore */ script)) as { CLONEDIR_SOURCE: string }
    expect(CLONEDIR_SOURCE).toBe(fast.CLONEDIR_SOURCE)
    expect(existsSync('scripts/build-helpers.mjs')).toBe(true)
  })
})
