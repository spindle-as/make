/** Compare dotted versions ("v0.10.1" > "0.9.3"); pre-release suffixes sort before the release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (x.pre && !y.pre) return -1
  if (!x.pre && y.pre) return 1
  return (x.pre ?? '').localeCompare(y.pre ?? '')
}

export function slugify(input: string, max = 40): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, max).replace(/-+$/g, '') || 'feature'
}

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** Parse "owner/repo" out of a git remote url (https or ssh). */
export function parseGithubRemote(url: string): string | undefined {
  const m = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}` : undefined
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** Replace or append KEY=value in a .env file body. */
export function setEnvValue(body: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  return re.test(body) ? body.replace(re, () => line) : body.replace(/\n?$/, `\n${line}\n`)
}

const STOP = new Set(
  'a an the and or but to of in on for with from into at by please can could would you i we me my our it this that be is are was add make create build implement fix update change new some so then also just want need lets let og en et i på til for med av å jeg vi kan skal lage legg'.split(' ')
)

/** Short human title from a prompt: first sentence/line, trimmed to ~60 chars. */
export function titleFromPrompt(prompt: string, max = 60): string {
  const first = prompt.trim().split(/\n|(?<=[.!?])\s/)[0]?.trim() ?? ''
  const t = first.replace(/^(please|can you|could you|kan du)\s+/i, '')
  const cap = t.charAt(0).toUpperCase() + t.slice(1)
  return cap.length > max ? cap.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : cap || 'New thread'
}

/** Branch-friendly slug from the meaningful words of a prompt. */
export function slugFromPrompt(prompt: string, maxWords = 5): string {
  const words = slugify(prompt, 200)
    .split('-')
    .filter((w) => w && !STOP.has(w))
  return slugify(words.slice(0, maxWords).join('-') || prompt, 40)
}
