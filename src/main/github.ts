import { exec, run } from './exec'
import type { AccessRole, CheckRun, GithubRepoRef, PullRequestInfo, RepoAccess, WorkflowRun } from '@shared/types'

const gh = (args: string[], cwd?: string, timeoutMs = 60_000) => run('gh', args, { cwd, timeoutMs })

interface RollupItem {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
  workflowName?: string
}

export function mapCheck(c: RollupItem): CheckRun {
  if (c.__typename === 'StatusContext' || (c.context && !c.name)) {
    const st = (c.state || '').toUpperCase()
    const bucket: CheckRun['bucket'] =
      st === 'SUCCESS' ? 'pass' : st === 'FAILURE' || st === 'ERROR' ? 'fail' : 'pending'
    return { name: c.context || 'status', state: st, bucket, link: c.targetUrl }
  }
  const status = (c.status || '').toUpperCase()
  const conclusion = (c.conclusion || '').toUpperCase()
  let bucket: CheckRun['bucket'] = 'pending'
  if (status === 'COMPLETED') {
    if (conclusion === 'SUCCESS') bucket = 'pass'
    else if (['SKIPPED', 'NEUTRAL'].includes(conclusion)) bucket = 'skipping'
    else if (conclusion === 'CANCELLED') bucket = 'cancel'
    else bucket = 'fail'
  }
  return {
    name: c.name || 'check',
    state: status === 'COMPLETED' ? conclusion : status,
    bucket,
    link: c.detailsUrl,
    workflow: c.workflowName
  }
}

const PR_FIELDS =
  'number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,baseRefName,statusCheckRollup'

function toPr(j: Record<string, unknown>): PullRequestInfo {
  const rollup = (j.statusCheckRollup as RollupItem[] | null) ?? []
  return {
    number: j.number as number,
    url: j.url as string,
    title: j.title as string,
    state: j.state as PullRequestInfo['state'],
    isDraft: !!j.isDraft,
    mergeable: (j.mergeable as string) ?? 'UNKNOWN',
    mergeStateStatus: j.mergeStateStatus as string | undefined,
    reviewDecision: (j.reviewDecision as string) || undefined,
    headRefName: j.headRefName as string,
    baseRefName: j.baseRefName as string,
    checks: rollup.map(mapCheck)
  }
}

export async function findPrForBranch(repo: string, branch: string): Promise<number | undefined> {
  const r = await exec('gh', ['pr', 'list', '-R', repo, '--head', branch, '--state', 'all', '--json', 'number', '-L', '1'])
  if (r.code !== 0) return undefined
  const arr = JSON.parse(r.stdout || '[]') as { number: number }[]
  return arr[0]?.number
}

export async function viewPr(repo: string, number: number): Promise<PullRequestInfo> {
  const out = await gh(['pr', 'view', String(number), '-R', repo, '--json', PR_FIELDS])
  return toPr(JSON.parse(out))
}

export async function createPr(
  repo: string,
  cwd: string,
  opts: { title: string; body: string; base: string; head: string; draft: boolean }
): Promise<PullRequestInfo> {
  const args = ['pr', 'create', '-R', repo, '--title', opts.title, '--body', opts.body || ' ', '--base', opts.base, '--head', opts.head]
  if (opts.draft) args.push('--draft')
  const url = await gh(args, cwd)
  const num = Number(url.trim().split('/').pop())
  return viewPr(repo, num)
}

export async function mergePr(repo: string, number: number, method: 'squash' | 'merge' | 'rebase'): Promise<string> {
  return gh(['pr', 'merge', String(number), '-R', repo, `--${method}`], undefined, 120_000)
}

export async function deleteRemoteBranch(cwd: string, branch: string): Promise<void> {
  await exec('git', ['push', 'origin', '--delete', branch], { cwd, timeoutMs: 60_000 })
}

export async function listRuns(repo: string, branch: string): Promise<WorkflowRun[]> {
  const out = await gh([
    'run',
    'list',
    '-R',
    repo,
    '--branch',
    branch,
    '-L',
    '15',
    '--json',
    'databaseId,name,displayTitle,status,conclusion,headBranch,event,url,createdAt'
  ])
  return JSON.parse(out || '[]')
}

export async function failedRunLog(repo: string, runId: number): Promise<string> {
  const r = await exec('gh', ['run', 'view', String(runId), '-R', repo, '--log-failed'], { timeoutMs: 120_000 })
  const text = (r.stdout || r.stderr).trim()
  // Keep the tail: failures are at the end and agents have finite context.
  const lines = text.split('\n')
  return lines.length > 400 ? lines.slice(-400).join('\n') : text
}

export async function rerunFailed(repo: string, runId: number): Promise<string> {
  return gh(['run', 'rerun', String(runId), '-R', repo, '--failed'])
}

export async function currentLogin(): Promise<string | undefined> {
  const r = await exec('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 20_000 })
  return r.code === 0 ? r.stdout.trim() : undefined
}

function roleFrom(p: { admin?: boolean; maintain?: boolean; push?: boolean } | undefined): AccessRole {
  if (!p) return 'unknown'
  if (p.admin || p.maintain) return 'maintainer'
  if (p.push) return 'developer'
  return 'contributor'
}

/**
 * The user's real permission on the repo, straight from GitHub. Maintainers may merge and
 * deploy; developers may push and merge (GitHub's own branch rules still apply); contributors
 * work on a fork and their workflow ends at "Submit for review".
 */
export async function repoAccess(repo: string, restricted: boolean): Promise<RepoAccess> {
  const r = await exec('gh', ['api', `repos/${repo}`, '--jq', '.permissions'], { timeoutMs: 20_000 })
  const login = await currentLogin()
  if (r.code !== 0) {
    return { role: 'unknown', login, canPush: false, canMerge: false, canDeploy: false, checkedAt: Date.now(), detail: (r.stderr || r.stdout).trim().split('\n')[0] }
  }
  const role = roleFrom(JSON.parse(r.stdout || '{}'))
  return {
    role,
    login,
    canPush: role === 'maintainer' || role === 'developer',
    canMerge: !restricted && (role === 'maintainer' || role === 'developer'),
    canDeploy: !restricted && role === 'maintainer',
    checkedAt: Date.now()
  }
}

/** Repositories the user can open, most recently updated first. */
export async function listRepos(query?: string): Promise<GithubRepoRef[]> {
  const out = await gh(
    ['api', '--paginate', 'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', '--jq', '.[] | {n: .full_name, d: .description, p: .private, u: .updated_at, perm: .permissions}'],
    undefined,
    60_000
  )
  const repos = out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { n: string; d: string | null; p: boolean; u: string; perm?: { admin?: boolean; maintain?: boolean; push?: boolean } })
    .map((r) => ({ nameWithOwner: r.n, description: r.d ?? undefined, isPrivate: r.p, updatedAt: r.u, permission: roleFrom(r.perm) }))
  const q = query?.trim().toLowerCase()
  return (q ? repos.filter((r) => `${r.nameWithOwner} ${r.description ?? ''}`.toLowerCase().includes(q)) : repos).slice(0, 200)
}

/** For contributors without push access: make sure a fork exists and is a remote, return "login:branch" head. */
export async function ensureFork(repo: string, cwd: string, login: string): Promise<string> {
  await exec('gh', ['repo', 'fork', repo, '--clone=false', '--remote=false'], { cwd, timeoutMs: 120_000 })
  const forkUrl = `https://github.com/${login}/${repo.split('/')[1]}.git`
  const has = await exec('git', ['remote', 'get-url', 'fork'], { cwd })
  if (has.code !== 0) await exec('git', ['remote', 'add', 'fork', forkUrl], { cwd })
  return login
}
