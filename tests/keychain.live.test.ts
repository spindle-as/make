import { describe, expect, it } from 'vitest'
import { keychainDelete, keychainGet, keychainSet } from '../src/main/keychain'

/** Opt-in (touches the login keychain): SF_LIVE_KEYCHAIN=1 npx vitest run tests/keychain.live.test.ts */
describe.skipIf(process.env.SF_LIVE_KEYCHAIN !== '1')('keychain', () => {
  const service = 'no.spindle.make.test'
  it('stores, updates, reads and deletes a secret', () => {
    const tricky = `tok"en 'with' spaces\\ and ünicode ${Date.now()}`
    expect(keychainSet('ploi', 'first', service)).toBe(true)
    expect(keychainSet('ploi', tricky, service)).toBe(true) // -U updates in place
    expect(keychainGet('ploi', service)).toBe(tricky)
    keychainDelete('ploi', service)
    expect(keychainGet('ploi', service)).toBeUndefined()
  })
})
