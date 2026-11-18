import { execFileSync } from 'node:child_process'

/**
 * Secrets in the macOS login Keychain, via Apple's `security` tool.
 *
 * Why not Electron's safeStorage: its key is tied to the app's code signature. Spindle Make is
 * ad-hoc signed, so every build (every update) has a new signature and can no longer decrypt what
 * the previous build stored. Keychain items created by /usr/bin/security are readable by that same
 * tool regardless of which app build asks, so secrets survive updates.
 *
 * Values never appear on a command line: they go in through `security -i` on stdin, hex-encoded.
 * The stored password is "b64:<base64>" so it is plain ASCII (`security -w` prints anything else
 * as hex, which would be ambiguous).
 */
export const SERVICE = 'no.spindle.make'

export function keychainGet(account: string, service = SERVICE): string | undefined {
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 })
    const v = out.replace(/\n$/, '')
    if (!v) return undefined
    return v.startsWith('b64:') ? Buffer.from(v.slice(4), 'base64').toString('utf8') : v
  } catch {
    return undefined
  }
}

export function keychainSet(account: string, value: string, service = SERVICE): boolean {
  if (!/^[\w.-]+$/.test(account) || !/^[\w.-]+$/.test(service)) throw new Error('Invalid keychain account or service name')
  const hex = Buffer.from('b64:' + Buffer.from(value, 'utf8').toString('base64'), 'utf8').toString('hex')
  try {
    execFileSync('security', ['-i'], { input: `add-generic-password -U -s ${service} -a ${account} -l "Spindle Make (${account})" -X ${hex}\n`, stdio: ['pipe', 'ignore', 'pipe'], timeout: 10_000 })
    return keychainGet(account, service) === value
  } catch {
    return false
  }
}

export function keychainDelete(account: string, service = SERVICE): void {
  try {
    execFileSync('security', ['delete-generic-password', '-s', service, '-a', account], { stdio: 'ignore', timeout: 10_000 })
  } catch {
    /* not there */
  }
}
