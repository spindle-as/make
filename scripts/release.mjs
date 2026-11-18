#!/usr/bin/env node
/**
 * Cut a release in one command:
 *
 *   npm run release              → next patch (0.1.0 → 0.1.1)
 *   npm run release -- minor     → 0.2.0      (also: major, or an exact version like 1.0.0)
 *   npm run release -- --dry-run → show what would happen, change nothing
 *
 * It checks the tree is clean and up to date, runs typecheck + tests, bumps the version,
 * moves "## Unreleased" in CHANGELOG.md under the new version (or lists the commits since the
 * last release when that section is empty), commits, tags vX.Y.Z and pushes. GitHub Actions
 * then builds the app, publishes the release with checksums, and installed apps offer the update.
 *
 *   node scripts/release.mjs notes v1.2.3  → print that version's release notes (used by CI)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', ...opts })?.toString().trim()
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))

if (positional[0] === 'notes') {
  process.stdout.write(notesFor(positional[1]))
  process.exit(0)
}

function changelog() {
  try {
    return readFileSync('CHANGELOG.md', 'utf8')
  } catch {
    return '# Changelog\n\n## Unreleased\n'
  }
}

/** Body of "## vX.Y.Z" (or "## X.Y.Z") from CHANGELOG.md, plus install notes. */
function notesFor(tag) {
  const version = String(tag ?? '').replace(/^v/, '')
  const text = changelog()
  const re = new RegExp(`^## v?${version.replace(/\./g, '\\.')}\\b.*$`, 'm')
  const m = text.match(re)
  let body = ''
  if (m) {
    const rest = text.slice(m.index + m[0].length)
    const next = rest.search(/^## /m)
    body = (next === -1 ? rest : rest.slice(0, next)).trim()
  }
  return `${body || 'Maintenance release.'}

---

**Install:** download \`Spindle-Make-${version}-arm64.dmg\`, open it and drag Spindle Make to Applications. The app isn't notarized by Apple yet, so the first time macOS says it can't check it: open System Settings → Privacy & Security and click *Open Anyway* (or run \`xattr -cr "/Applications/Spindle Make.app"\`). Updates after that install without the warning.
**Update:** Spindle Make checks for new versions by itself — click *Restart to update* in the sidebar when it appears.
`
}

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(kind)) return kind
  const [maj, min, pat] = current.split('-')[0].split('.').map(Number)
  if (kind === 'major') return `${maj + 1}.0.0`
  if (kind === 'minor') return `${maj}.${min + 1}.0`
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`
  fail(`Unknown version "${kind}". Use patch, minor, major or an exact version like 1.2.3.`)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const kind = (positional[0] ?? 'patch').replace(/^v(?=\d)/, '')

// --- preflight ---
if (sh('git', ['status', '--porcelain'])) fail('You have uncommitted changes. Commit or stash them first.')
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`Releases are cut from main (you are on ${branch}).`)
try {
  sh('git', ['fetch', '--quiet', '--tags', 'origin'])
} catch {
  fail('Couldn’t reach origin. Is the GitHub remote set up?')
}
const behind = Number(sh('git', ['rev-list', '--count', 'HEAD..origin/main']) || 0)
if (behind) fail(`main is ${behind} commit(s) behind origin/main. Pull first.`)

const lastTag = (() => {
  try {
    return sh('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
  } catch {
    return null
  }
})()
// The very first release can ship the version already in package.json.
const version = !lastTag && !positional[0] ? pkg.version : bump(pkg.version, kind)
const tag = `v${version}`
if (sh('git', ['tag', '--list', tag])) fail(`${tag} already exists.`)

// --- notes: the Unreleased section, or the commits since the last release ---
let text = changelog()
const unreleased = text.match(/^## Unreleased\s*$/m)
let section = ''
if (unreleased) {
  const rest = text.slice(unreleased.index + unreleased[0].length)
  const next = rest.search(/^## /m)
  section = (next === -1 ? rest : rest.slice(0, next)).trim()
}
if (!section) {
  const range = lastTag ? [`${lastTag}..HEAD`] : []
  const subjects = sh('git', ['log', '--no-merges', '--pretty=format:%s', ...range])
    .split('\n')
    .filter((s) => s && !/^Release v/.test(s))
  section = subjects.length ? subjects.map((s) => `- ${s}`).join('\n') : '- Maintenance release.'
}
const date = new Date().toISOString().slice(0, 10)
const entry = `## ${tag} — ${date}\n\n${section}\n`
text = unreleased
  ? text.replace(/^## Unreleased\s*$[\s\S]*?(?=^## |(?![\s\S]))/m, `## Unreleased\n\n${entry}\n`)
  : text.replace(/^# Changelog\s*$/m, `# Changelog\n\n## Unreleased\n\n${entry}`)

console.log(`\nRelease ${tag}${lastTag ? ` (previous: ${lastTag})` : ' (first release)'}\n\n${section}\n`)
if (dry) {
  console.log('Dry run — nothing changed.')
  process.exit(0)
}

// --- checks ---
console.log('Running typecheck and tests…')
sh('npm', ['run', '--silent', 'typecheck'], { inherit: true })
sh('npm', ['test', '--silent'], { inherit: true })

// --- bump, commit, tag, push ---
if (version !== pkg.version) sh('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'])
writeFileSync('CHANGELOG.md', text.replace(/\n{3,}/g, '\n\n'))
sh('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md'])
sh('git', ['commit', '-m', `Release ${tag}`])
sh('git', ['tag', '-a', tag, '-m', `Spindle Make ${version}\n\n${section}`])
sh('git', ['push', '--follow-tags', 'origin', 'main'], { inherit: true })

const repo = pkg.repository?.url?.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')
console.log(`\n✓ Pushed ${tag}. GitHub Actions is building it now:\n  https://github.com/${repo}/actions\n  The release appears at https://github.com/${repo}/releases/tag/${tag} in a few minutes.\n`)
