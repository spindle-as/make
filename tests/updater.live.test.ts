import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Updater } from '../src/main/updater'

/**
 * Opt-in: SF_LIVE_UPDATE=1 npx vitest run tests/updater.live.test.ts
 * Checks the real latest GitHub release the way an installed app would: finds it, downloads the
 * zip, verifies SHA256SUMS.txt, unpacks it and checks the bundle id and version. Installs nothing.
 */
describe.skipIf(process.env.SF_LIVE_UPDATE !== '1')('live GitHub release', () => {
  it('can be found, downloaded and verified by the updater', async () => {
    const u = new Updater({
      currentVersion: '0.0.1',
      packaged: true,
      execPath: '/Applications/Spindle Make.app/Contents/MacOS/Spindle Make',
      workDir: mkdtempSync(join(tmpdir(), 'sf-live-upd-')),
      arch: 'arm64',
      onChange: () => {}
    })
    const s = await u.check()
    expect(s.status).toBe('available')
    const d = await u.download()
    expect(d.error).toBeUndefined()
    expect(d.status).toBe('ready')
  }, 300_000)
})
