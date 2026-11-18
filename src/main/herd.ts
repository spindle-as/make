import { exec, run } from './exec'
import type { HerdSite } from '@shared/types'

/** Parse Herd's ASCII table output (`herd links`, `herd parked`). */
export function parseHerdTable(out: string): HerdSite[] {
  const sites: HerdSite[] = []
  for (const line of out.split('\n')) {
    if (!line.startsWith('|')) continue
    const cols = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cols.length < 4 || !cols[0] || cols[0] === 'Site') continue
    sites.push({
      site: cols[0],
      secured: cols[1] === 'X',
      url: cols[2],
      path: cols[3],
      php: cols[4] || undefined
    })
  }
  return sites
}

export async function available(): Promise<boolean> {
  if (process.env.SF_NO_HERD === '1') return false // test hook: never touch the real Herd setup
  return (await exec('herd', ['--version'])).code === 0
}

export async function sites(): Promise<HerdSite[]> {
  const [links, parked] = await Promise.all([exec('herd', ['links']), exec('herd', ['parked'])])
  const all = [...parseHerdTable(links.stdout), ...parseHerdTable(parked.stdout)]
  const seen = new Set<string>()
  return all.filter((s) => (seen.has(s.site) ? false : (seen.add(s.site), true)))
}

export async function tld(): Promise<string> {
  const r = await exec('herd', ['tld'])
  return r.stdout.trim() || 'test'
}

/** Find the PHP version Herd uses for a directory, if it is a known site. */
export async function phpFor(path: string): Promise<string | undefined> {
  const all = await sites()
  return all.find((s) => s.path === path)?.php
}

/** Link `dir` as `<name>.test`, optionally securing it. Returns the site URL. */
export async function link(dir: string, name: string, secure: boolean, isolatePhp?: string): Promise<string> {
  await run('herd', ['link', name, '--no-interaction'], { cwd: dir, timeoutMs: 60_000 })
  if (isolatePhp) await exec('herd', ['isolate', isolatePhp, '--no-interaction'], { cwd: dir, timeoutMs: 120_000 })
  const t = await tld()
  if (secure) {
    const r = await exec('herd', ['secure', name, '--no-interaction'], { timeoutMs: 120_000 })
    if (r.code === 0) return `https://${name}.${t}`
  }
  return `http://${name}.${t}`
}

export async function unlink(dir: string, name: string): Promise<void> {
  await exec('herd', ['unsecure', name, '--no-interaction'], { timeoutMs: 60_000 })
  await exec('herd', ['unlink', name, '--no-interaction'], { cwd: dir, timeoutMs: 60_000 })
}
