import { describe, expect, it } from 'vitest'
import { ciGate } from '../src/shared/ci'
import type { CheckRun, WorkflowRun } from '../src/shared/types'

const check = (name: string, bucket: CheckRun['bucket']): CheckRun => ({ name, state: bucket.toUpperCase(), bucket })
const run = (name: string, status: string, conclusion = ''): WorkflowRun => ({ databaseId: 1, name, displayTitle: '', status, conclusion, headBranch: 'b', event: 'push', url: '', createdAt: '' })

describe('merge only on green CI', () => {
  it('allows green checks and repos without CI', () => {
    expect(ciGate([check('test', 'pass'), check('lint', 'skipping')])).toMatchObject({ ok: true, state: 'green' })
    expect(ciGate([], [])).toMatchObject({ ok: true, state: 'none' })
  })
  it('blocks while anything is running, including workflows that have not reported a check yet', () => {
    expect(ciGate([check('test', 'pending')])).toMatchObject({ ok: false, state: 'running', pending: ['test'] })
    const g = ciGate([check('test', 'pass')], [run('Deploy preview', 'in_progress')])
    expect(g).toMatchObject({ ok: false, state: 'running', pending: ['Deploy preview'] })
    expect(g.reason).toMatch(/still running/)
    expect(ciGate([], [run('CI', 'queued')]).ok).toBe(false)
    expect(ciGate([check('test', 'pass')], [run('CI', 'completed', 'success')]).ok).toBe(true)
  })
  it('blocks after failures and cancellations, and failure wins over running', () => {
    expect(ciGate([check('test', 'fail')])).toMatchObject({ ok: false, state: 'failed', failing: ['test'] })
    expect(ciGate([check('test', 'cancel')]).ok).toBe(false)
    const g = ciGate([check('a', 'fail'), check('b', 'pending'), check('c', 'fail'), check('d', 'fail'), check('e', 'fail')])
    expect(g.state).toBe('failed')
    expect(g.reason).toContain('a, c, d and 1 more')
  })
})
