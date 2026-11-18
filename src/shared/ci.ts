import type { CheckRun, WorkflowRun } from './types'

export interface CiGate {
  /** merging is allowed */
  ok: boolean
  state: 'green' | 'running' | 'failed' | 'none'
  pending: string[]
  failing: string[]
  /** why merging is blocked, in plain words */
  reason?: string
}

/**
 * Merge only on green CI: never while checks are running (including workflow runs that haven't
 * reported a check yet) or after any failed/cancelled check. A repo without CI is allowed.
 */
export function ciGate(checks: CheckRun[], runs: WorkflowRun[] = []): CiGate {
  const failing = checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel').map((c) => c.name)
  const pending = checks.filter((c) => c.bucket === 'pending').map((c) => c.name)
  for (const r of runs) {
    // A workflow still in progress blocks merging even if some of its jobs already passed.
    if (r.status !== 'completed' && !pending.includes(r.name)) pending.push(r.name)
  }
  const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '))
  if (failing.length) return { ok: false, state: 'failed', pending, failing, reason: `CI failed (${list(failing)}). Fix it and wait for green before merging.` }
  if (pending.length) return { ok: false, state: 'running', pending, failing, reason: `CI is still running (${list(pending)}). Merge when it’s green.` }
  if (!checks.length && !runs.length) return { ok: true, state: 'none', pending, failing }
  return { ok: true, state: 'green', pending, failing }
}
