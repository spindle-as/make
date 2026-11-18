import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/shared/util'
import { bundleOf, INSTALL_SCRIPT, parseChecksums, pickAsset, Updater } from '../src/main/updater'
import type { UpdateState } from '../src/shared/types'

const tmp = () => mkdtempSync(join(tmpdir(), 'sf-upd-'))

/** A minimal "Spindle Make.app" with the given version, zipped like electron-builder does. */
function fakeAppZip(version: string, bundleId = 'no.spindle.make'): Buffer {
  const dir = tmp()
  const app = join(dir, 'Spindle Make.app', 'Contents')
  mkdirSync(join(app, 'MacOS'), { recursive: true })
  writeFileSync(
    join(app, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
  )
  writeFileSync(join(app, 'MacOS', 'Spindle Make'), `#!/bin/sh\necho ${version}\n`)
  const zip = join(dir, 'out.zip')
  execFileSync('ditto', ['-c', '-k', '--keepParent', join(dir, 'Spindle Make.app'), zip])
  return readFileSync(zip)
}

function fakeGitHub(version: string, zip: Buffer, opts: { badSum?: boolean; noSums?: boolean } = {}) {
  const name = `Spindle Make-${version}-arm64-mac.zip`
  const sum = opts.badSum ? '0'.repeat(64) : createHash('sha256').update(zip).digest('hex')
  const assets = [
    { name, size: zip.length, browser_download_url: `https://dl/${name}` },
    { name: `Spindle Make-${version}-arm64.dmg`, size: 1, browser_download_url: 'https://dl/dmg' },
    ...(opts.noSums ? [] : [{ name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'https://dl/sums' }])
  ]
  return (async (url: string) => {
    if (String(url).includes('/releases/latest')) {
      return new Response(JSON.stringify({ tag_name: `v${version}`, body: '## New\n- things', html_url: 'https://github.com/x', published_at: '2026-11-18T10:00:00Z', assets }), { status: 200 })
    }
    if (String(url) === 'https://dl/sums') return new Response(`${sum}  ${name}\n`, { status: 200 })
    if (String(url) === `https://dl/${name}`) return new Response(zip, { status: 200, headers: { 'content-length': String(zip.length) } })
    return new Response('nope', { status: 404 })
  }) as typeof fetch
}

function updater(version: string, f: typeof fetch, packaged = true) {
  const states: UpdateState[] = []
  const u = new Updater({
    currentVersion: version,
    packaged,
    execPath: '/Applications/Spindle Make.app/Contents/MacOS/Spindle Make',
    workDir: tmp(),
    arch: 'arm64',
    fetch: f,
    onChange: (s) => states.push(s)
  })
  return { u, states }
}

describe('update helpers', () => {
  it('compares versions', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('v0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1)
  })
  it('picks the zip for this Mac and parses checksums', () => {
    const assets = [
      { name: 'Spindle Make-0.2.0-arm64-mac.zip', size: 1, browser_download_url: 'a' },
      { name: 'Spindle Make-0.2.0-mac.zip', size: 1, browser_download_url: 'b' },
      { name: 'Spindle Make-0.2.0-arm64.dmg', size: 1, browser_download_url: 'c' }
    ]
    expect(pickAsset(assets, 'arm64')?.browser_download_url).toBe('a')
    expect(pickAsset(assets, 'x64')?.browser_download_url).toBe('b')
    expect(pickAsset(assets.slice(1), 'arm64')).toBeUndefined() // never install an Intel build on Apple Silicon
    const h = 'a'.repeat(64)
    expect(parseChecksums(`${h}  Spindle Make-0.2.0-arm64-mac.zip\n${'b'.repeat(64)} *other.dmg\njunk`)).toEqual({ 'Spindle Make-0.2.0-arm64-mac.zip': h, 'other.dmg': 'b'.repeat(64) })
  })
  it('finds the running bundle', () => {
    expect(bundleOf('/Applications/Spindle Make.app/Contents/MacOS/Spindle Make')).toBe('/Applications/Spindle Make.app')
    expect(bundleOf('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')).toBe('/repo/node_modules/electron/dist/Electron.app')
    expect(bundleOf('/usr/local/bin/node')).toBeNull()
  })
})

describe('Updater', () => {
  it('finds, downloads, verifies and unpacks a newer release', async () => {
    const zip = fakeAppZip('0.2.0')
    const { u, states } = updater('0.1.0', fakeGitHub('0.2.0', zip))
    const s = await u.check()
    expect(s).toMatchObject({ status: 'available', latest: '0.2.0', canInstall: true, notes: '## New\n- things', size: zip.length })
    const d = await u.download()
    expect(d.status).toBe('ready')
    expect(states.some((x) => x.status === 'downloading')).toBe(true)
    // A ready update isn't lost by another check.
    expect((await u.check()).status).toBe('ready')
  })

  it('reports up to date, and no releases yet', async () => {
    expect((await updater('0.2.0', fakeGitHub('0.2.0', Buffer.from('x'))).u.check()).status).toBe('none')
    expect((await updater('0.3.0', fakeGitHub('0.2.0', Buffer.from('x'))).u.check()).status).toBe('none')
    const none = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
    expect((await updater('0.1.0', none).u.check()).status).toBe('none')
  })

  it('refuses a download that does not match its checksum, or has none', async () => {
    const zip = fakeAppZip('0.2.0')
    const bad = await updater('0.1.0', fakeGitHub('0.2.0', zip, { badSum: true })).u.download()
    expect(bad).toMatchObject({ status: 'error' })
    expect(bad.error).toMatch(/checksum/)
    const none = await updater('0.1.0', fakeGitHub('0.2.0', zip, { noSums: true })).u.download()
    expect(none.error).toMatch(/SHA256SUMS/)
  })

  it('refuses an app that is not Spindle Make or not the promised version', async () => {
    const other = await updater('0.1.0', fakeGitHub('0.2.0', fakeAppZip('0.2.0', 'com.evil.app'))).u.download()
    expect(other.error).toMatch(/isn’t Spindle Make/)
    const wrong = await updater('0.1.0', fakeGitHub('0.2.0', fakeAppZip('0.1.5'))).u.download()
    expect(wrong.error).toMatch(/version 0\.1\.5, expected 0\.2\.0/)
  })

  it('never installs into a development build', async () => {
    const { u } = updater('0.1.0', fakeGitHub('0.2.0', fakeAppZip('0.2.0')), false)
    expect((await u.check()).canInstall).toBe(false)
    expect(() => u.install()).toThrow(/development build/)
  })
})

describe('install script', () => {
  it('swaps the bundle and relaunches', () => {
    const dir = tmp()
    const target = join(dir, 'Spindle Make.app')
    const fresh = join(dir, 'new', 'Spindle Make.app')
    mkdirSync(target)
    writeFileSync(join(target, 'v'), 'old')
    mkdirSync(fresh, { recursive: true })
    writeFileSync(join(fresh, 'v'), 'new')
    // Fake `open` so the test doesn't launch anything.
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'open'), `#!/bin/sh\necho "$1" > "${join(dir, 'opened')}"\n`)
    chmodSync(join(bin, 'open'), 0o755)
    const script = join(dir, 'install.sh')
    writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 })
    const r = spawnSync('/bin/sh', [script], { env: { PATH: `${bin}:/usr/bin:/bin`, SPINDLE_PID: '999999', SPINDLE_APP: target, SPINDLE_NEW: fresh } })
    expect(r.status).toBe(0)
    expect(readFileSync(join(target, 'v'), 'utf8')).toBe('new')
    expect(readFileSync(join(dir, 'opened'), 'utf8').trim()).toBe(target)
    expect(existsSync(fresh)).toBe(false)
    expect(existsSync(script)).toBe(false) // cleans up after itself
  })

  it('puts the old app back when the new one cannot be moved in', () => {
    const dir = tmp()
    const target = join(dir, 'Spindle Make.app')
    mkdirSync(target)
    writeFileSync(join(target, 'v'), 'old')
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'open'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, 'open'), 0o755)
    const script = join(dir, 'install.sh')
    writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 })
    spawnSync('/bin/sh', [script], { env: { PATH: `${bin}:/usr/bin:/bin`, SPINDLE_PID: '999999', SPINDLE_APP: target, SPINDLE_NEW: join(dir, 'missing.app') } })
    expect(readFileSync(join(target, 'v'), 'utf8')).toBe('old')
  })
})
