import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateState } from '@shared/types'
import { compareVersions } from '@shared/util'
import { exec } from './exec'

/**
 * Self-updater for an unsigned macOS app (Squirrel.Mac needs a Developer ID, so we don't use it).
 *
 * 1. check:    GitHub "latest release" → newer version than ours?
 * 2. download: the release's arm64 .zip, verified against SHA256SUMS.txt from the same release
 * 3. verify:   unpack with ditto; bundle id and version must match what we expect
 * 4. install:  after the app quits, a tiny script swaps the .app bundle (keeping a backup until the
 *              new one is in place) and relaunches it. Files downloaded by the app itself carry no
 *              quarantine flag, so Gatekeeper doesn't block the new version.
 */

export const REPO = 'spindle-as/make'
export const BUNDLE_ID = 'no.spindle.make'

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}
interface Release {
  tag_name: string
  name?: string
  body?: string
  html_url: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets: ReleaseAsset[]
}

export interface UpdaterOptions {
  currentVersion: string
  /** packaged app (not `electron-vite dev`) */
  packaged: boolean
  /** path of the running executable (…/X.app/Contents/MacOS/X) */
  execPath: string
  workDir: string
  arch?: string
  onChange: (s: UpdateState) => void
  /** injectable for tests */
  fetch?: typeof fetch
}

/** Pick the zip for this machine from a release's assets. */
export function pickAsset(assets: ReleaseAsset[], arch: string = process.arch): ReleaseAsset | undefined {
  const zips = assets.filter((a) => a.name.endsWith('.zip'))
  return zips.find((a) => a.name.includes(arch)) ?? (arch === 'arm64' ? undefined : zips.find((a) => !a.name.includes('arm64')))
}

/** "abc123  Spindle Make-0.2.0-arm64-mac.zip" lines → { file: sha256 } */
export function parseChecksums(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
    if (m) out[m[2].trim()] = m[1].toLowerCase()
  }
  return out
}

/** The .app bundle containing an executable path, or null when not running from a bundle. */
export function bundleOf(execPath: string): string | null {
  const m = execPath.match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/)
  return m ? m[1] : null
}

export class Updater {
  private state: UpdateState
  private release?: Release
  private readyApp?: string
  private timer?: NodeJS.Timeout
  private busy?: Promise<UpdateState>

  constructor(private opts: UpdaterOptions) {
    this.state = { status: 'idle', current: opts.currentVersion, canInstall: opts.packaged && !!bundleOf(opts.execPath) }
  }

  get(): UpdateState {
    return { ...this.state }
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch }
    this.opts.onChange(this.get())
    return this.get()
  }

  private get fetch(): typeof fetch {
    return this.opts.fetch ?? fetch
  }

  /** Check now and every 6 hours; with `autoDownload`, fetch new versions in the background. */
  startSchedule(autoDownload: () => boolean): void {
    const tick = async () => {
      const s = await this.check().catch(() => this.get())
      if (s.status === 'available' && s.canInstall && autoDownload()) await this.download().catch(() => {})
    }
    setTimeout(() => void tick(), 15_000)
    this.timer = setInterval(() => void tick(), 6 * 60 * 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  check(): Promise<UpdateState> {
    if (this.busy) return this.busy
    // A downloaded update stays ready until it is installed.
    if (this.state.status === 'ready' || this.state.status === 'downloading') return Promise.resolve(this.get())
    this.busy = this.doCheck().finally(() => {
      this.busy = undefined
    })
    return this.busy
  }

  private async doCheck(): Promise<UpdateState> {
    this.set({ status: 'checking', error: undefined })
    try {
      // SF_UPDATE_API: test hook to point the updater at a local fake release feed.
      const res = await this.fetch(process.env.SF_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Spindle-Make-Updater' }
      })
      if (res.status === 404) return this.set({ status: 'none', checkedAt: Date.now(), latest: undefined })
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      const rel = (await res.json()) as Release
      const latest = rel.tag_name.replace(/^v/, '')
      this.release = rel
      const asset = pickAsset(rel.assets, this.opts.arch)
      const newer = compareVersions(latest, this.opts.currentVersion) > 0
      return this.set({
        status: newer && asset ? 'available' : 'none',
        latest,
        notes: rel.body ?? '',
        url: rel.html_url,
        publishedAt: rel.published_at,
        size: asset?.size,
        checkedAt: Date.now()
      })
    } catch (e) {
      return this.set({ status: 'error', error: `Couldn’t check for updates: ${(e as Error).message}`, checkedAt: Date.now() })
    }
  }

  download(): Promise<UpdateState> {
    if (this.busy) return this.busy
    if (this.state.status === 'ready') return Promise.resolve(this.get())
    this.busy = (async () => {
      try {
        if (!this.release || this.state.status !== 'available') {
          const s = await this.doCheck()
          if (s.status !== 'available') return s
        }
        const rel = this.release!
        const version = rel.tag_name.replace(/^v/, '')
        const asset = pickAsset(rel.assets, this.opts.arch)
        if (!asset) throw new Error('This release has no download for this Mac.')
        const sums = rel.assets.find((a) => a.name === 'SHA256SUMS.txt')
        if (!sums) throw new Error('This release has no SHA256SUMS.txt, so the download can’t be verified.')
        this.set({ status: 'downloading', progress: 0, error: undefined })

        const dir = join(this.opts.workDir, version)
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        const expected = parseChecksums(await (await this.get200(sums.browser_download_url)).text())[asset.name]
        if (!expected) throw new Error(`SHA256SUMS.txt doesn’t list ${asset.name}.`)

        const zip = join(dir, 'update.zip')
        const res = await this.get200(asset.browser_download_url)
        const total = Number(res.headers.get('content-length')) || asset.size
        const hash = createHash('sha256')
        let got = 0
        let lastEmit = 0
        const body = Readable.fromWeb(res.body as never)
        body.on('data', (chunk: Buffer) => {
          hash.update(chunk)
          got += chunk.length
          if (Date.now() - lastEmit > 250) {
            lastEmit = Date.now()
            this.set({ progress: total ? Math.min(0.99, got / total) : undefined })
          }
        })
        await pipeline(body, createWriteStream(zip))
        if (hash.digest('hex') !== expected) throw new Error('The download didn’t match its checksum — try again.')

        const out = join(dir, 'app')
        mkdirSync(out)
        const unz = await exec('ditto', ['-x', '-k', zip, out], { timeoutMs: 5 * 60_000 })
        if (unz.code !== 0) throw new Error(`Unpacking failed: ${unz.stderr.trim()}`)
        const app = readdirSync(out).find((n) => n.endsWith('.app'))
        if (!app) throw new Error('The download contains no app.')
        await verifyBundle(join(out, app), version)
        rmSync(zip, { force: true })
        this.readyApp = join(out, app)
        return this.set({ status: 'ready', progress: 1 })
      } catch (e) {
        return this.set({ status: 'error', progress: undefined, error: (e as Error).message })
      } finally {
        this.busy = undefined
      }
    })()
    return this.busy
  }

  private async get200(url: string): Promise<Response> {
    const res = await this.fetch(url, { headers: { 'User-Agent': 'Spindle-Make-Updater', Accept: 'application/octet-stream' }, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    return res
  }

  /**
   * Swap the bundle once this process has exited, then relaunch. Returns after the helper started;
   * the caller quits the app.
   */
  install(): void {
    const target = bundleOf(this.opts.execPath)
    if (!this.opts.packaged || !target) throw new Error('Updates install into the packaged app — this is a development build.')
    if (this.state.status !== 'ready' || !this.readyApp || !existsSync(this.readyApp)) throw new Error('Download the update first.')
    try {
      accessSync(dirname(target), constants.W_OK)
    } catch {
      throw new Error(`Spindle can’t write to ${dirname(target)}. Download the new version from ${this.state.url ?? 'GitHub'} instead.`)
    }
    const script = join(tmpdir(), `spindle-update-${process.pid}.sh`)
    writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 })
    const child = spawn('/bin/sh', [script], {
      detached: true,
      stdio: 'ignore',
      // SF_UPDATE_OPEN: test hook replacing `open` for the relaunch (keeps an isolated test instance isolated).
      env: { ...process.env, SPINDLE_PID: String(process.pid), SPINDLE_APP: target, SPINDLE_NEW: this.readyApp, SPINDLE_OPEN: process.env.SF_UPDATE_OPEN || 'open' }
    })
    child.unref()
  }
}

/** The unpacked app must be ours and the version we were promised. */
async function verifyBundle(app: string, version: string): Promise<void> {
  const plist = join(app, 'Contents', 'Info.plist')
  if (!existsSync(plist)) throw new Error('The downloaded app is incomplete.')
  const read = async (key: string) => (await exec('plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim()
  const id = await read('CFBundleIdentifier')
  const v = await read('CFBundleShortVersionString')
  if (id !== BUNDLE_ID) throw new Error(`The download isn’t Spindle Make (${id || 'unknown app'}).`)
  if (v !== version) throw new Error(`The download is version ${v}, expected ${version}.`)
  // Sanity: Info.plist must be readable as a plist (catches truncated archives).
  readFileSync(plist)
}

/**
 * Runs detached after the app quits: wait for the PID to exit, move the old bundle aside, move the
 * new one in (restoring the old one on failure), strip quarantine and relaunch.
 */
export const INSTALL_SCRIPT = `#!/bin/sh
i=0
while kill -0 "$SPINDLE_PID" 2>/dev/null; do
  sleep 0.2
  i=$((i+1))
  [ "$i" -gt 300 ] && exit 1
done
BACKUP="$SPINDLE_APP.old-$$"
OPEN="\${SPINDLE_OPEN:-open}"
if ! mv "$SPINDLE_APP" "$BACKUP"; then "$OPEN" "$SPINDLE_APP"; exit 1; fi
if mv "$SPINDLE_NEW" "$SPINDLE_APP"; then
  xattr -dr com.apple.quarantine "$SPINDLE_APP" 2>/dev/null
  rm -rf "$BACKUP"
else
  mv "$BACKUP" "$SPINDLE_APP"
fi
"$OPEN" "$SPINDLE_APP"
rm -f "$0"
`
