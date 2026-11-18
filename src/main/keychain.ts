import { execFile } from 'node:child_process'

/**
 * Secrets in the macOS login Keychain, via Apple's `security` tool.
 *
 * Why not Electron's safeStorage: its key is tied to the app's code signature. Spindle Make is
 * ad-hoc signed, so every build (every update) has a new signature and can no longer decrypt what
 * the previous build stored. Keychain items created by /usr/bin/security are readable by that same
 * tool regardless of which app build asks, so secrets survive updates.
 *
 * Everything here is async: a Keychain prompt must never freeze the app. Values never appear on a
 * command line: they go in through `security -i` on stdin, hex-encoded. The stored password is
 * "b64:<base64>" so it is plain ASCII (`security -w` prints anything else as hex).
 */
// SF_KEYCHAIN_SERVICE: test hook, so tests never touch the real item.
export const SERVICE = process.env.SF_KEYCHAIN_SERVICE || 'no.spindle.make'
const SECURITY = '/usr/bin/security'

function run(args: string[], input?: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(SECURITY, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && !stdout ? err.message : '') })
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

const decode = (raw: string): string | undefined => {
  const v = raw.replace(/\n$/, '')
  if (!v) return undefined
  return v.startsWith('b64:') ? Buffer.from(v.slice(4), 'base64').toString('utf8') : v
}

export async function keychainGet(account: string, service = SERVICE): Promise<{ value?: string; error?: string }> {
  const r = await run(['find-generic-password', '-s', service, '-a', account, '-w'])
  if (r.code === 0) return { value: decode(r.stdout) }
  // 44 = errSecItemNotFound: simply not stored.
  if (r.code === 44 || /could not be found/i.test(r.stderr)) return {}
  return { error: r.stderr.trim() || `security exited with ${r.code}` }
}

/** Store (or replace) a secret. Resolves with the reason when it didn't work. */
export async function keychainSet(account: string, value: string, service = SERVICE): Promise<{ ok: boolean; error?: string }> {
  if (!/^[\w.-]+$/.test(account) || !/^[\w.-]+$/.test(service)) return { ok: false, error: 'Invalid keychain account or service name' }
  const hex = Buffer.from('b64:' + Buffer.from(value, 'utf8').toString('base64'), 'utf8').toString('hex')
  // `security -i` keeps going after a failed command and may still exit 0, so its stderr counts too.
  const add = await run(['-i'], `add-generic-password -U -s ${service} -a ${account} -l "Spindle Make (${account})" -X ${hex}\n`)
  const addError = add.code !== 0 || /error|denied|not allowed|failed/i.test(add.stderr) ? add.stderr.trim() || `security exited with ${add.code}` : ''
  const back = await keychainGet(account, service)
  if (back.value === value) return { ok: true }
  return { ok: false, error: addError || back.error || (back.value === undefined ? 'The Keychain didn’t keep the item.' : 'The Keychain returned a different value.') }
}

export async function keychainDelete(account: string, service = SERVICE): Promise<void> {
  await run(['delete-generic-password', '-s', service, '-a', account])
}
