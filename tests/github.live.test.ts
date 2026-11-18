// Opt-in, read-only checks against real `gh` output: SF_LIVE=1 npx vitest run tests/github.live.test.ts
import { describe, expect, it } from 'vitest'
import { exec } from '../src/main/exec'
import * as github from '../src/main/github'

const live = process.env.SF_LIVE === '1'
const REPO = 'cli/cli'

describe.skipIf(!live)('github (live, read-only)', () => {
  it('views a recent PR with checks', async () => {
    const r = await exec('gh', ['pr', 'list', '-R', REPO, '--state', 'merged', '-L', '1', '--json', 'number'])
    const num = JSON.parse(r.stdout)[0].number as number
    const pr = await github.viewPr(REPO, num)
    expect(pr.number).toBe(num)
    expect(pr.state).toBe('MERGED')
    expect(Array.isArray(pr.checks)).toBe(true)
    for (const c of pr.checks) expect(['pass', 'fail', 'pending', 'skipping', 'cancel']).toContain(c.bucket)
    expect(await github.findPrForBranch(REPO, pr.headRefName)).toBeTypeOf('number')
  }, 60_000)

  it('lists workflow runs for a branch', async () => {
    const runs = await github.listRuns(REPO, 'trunk')
    expect(runs.length).toBeGreaterThan(0)
    expect(runs[0]).toHaveProperty('databaseId')
    expect(runs[0]).toHaveProperty('conclusion')
  }, 60_000)
})
