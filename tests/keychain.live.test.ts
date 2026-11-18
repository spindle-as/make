import { describe, expect, it } from 'vitest'
import { keychainDelete, keychainGet, keychainSet } from '../src/main/keychain'

/** Opt-in (touches the login keychain): SF_LIVE_KEYCHAIN=1 npx vitest run tests/keychain.live.test.ts */
describe.skipIf(process.env.SF_LIVE_KEYCHAIN !== '1')('keychain', () => {
  const service = 'no.spindle.make.test'
  it('stores, updates, reads and deletes a secret', async () => {
    const tricky = `tok"en 'with' spaces\\ and ünicode ${Date.now()}`
    expect(await keychainSet('ploi', 'first', service)).toEqual({ ok: true })
    expect(await keychainSet('ploi', tricky, service)).toEqual({ ok: true }) // -U updates in place
    expect((await keychainGet('ploi', service)).value).toBe(tricky)
    await keychainDelete('ploi', service)
    expect(await keychainGet('ploi', service)).toEqual({})
  })
  it('explains a failure instead of failing silently', async () => {
    const r = await keychainSet('bad account!', 'x', service)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Invalid/)
  })
})
