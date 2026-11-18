import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

/**
 * macOS GUI apps don't inherit the user's shell PATH, so `claude`, `codex`,
 * `gh`, `herd`, `composer`, `php` would not be found. Resolve it once from a
 * login shell and patch process.env.
 */
let resolved = false

export function loadShellEnv(): void {
  if (resolved) return
  resolved = true
  const shell = process.env.SHELL || '/bin/zsh'
  const extras = [
    `${homedir()}/.local/bin`,
    `${homedir()}/Library/Application Support/Herd/bin`,
    `${homedir()}/.composer/vendor/bin`,
    `${homedir()}/.config/composer/vendor/bin`,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin'
  ]
  try {
    const marker = '__SF_ENV__'
    const out = execFileSync(shell, ['-ilc', `echo ${marker}; env; echo ${marker}`], {
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' }
    })
    const body = out.split(marker)[1] ?? ''
    for (const line of body.split('\n')) {
      const i = line.indexOf('=')
      if (i <= 0) continue
      const key = line.slice(0, i)
      if (['PATH', 'HOME', 'LANG', 'SSH_AUTH_SOCK', 'NVM_DIR', 'HERD_PHP_83_INI_SCAN_DIR'].includes(key) || key.startsWith('HERD_')) {
        process.env[key] = line.slice(i + 1)
      }
    }
  } catch {
    // fall through to extras
  }
  const parts = new Set((process.env.PATH || '').split(':').filter(Boolean))
  for (const e of extras) parts.add(e)
  process.env.PATH = [...parts].join(':')
}
