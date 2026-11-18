import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as git from '../src/main/git'

let root: string
let repo: string
let wt: string
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-git-'))
  repo = join(root, 'repo')
  wt = join(root, 'wt', 'feature-a')
  execFileSync('mkdir', ['-p', repo])
  sh(repo, 'init', '-q', '-b', 'main')
  sh(repo, 'config', 'user.email', 'test@example.com')
  sh(repo, 'config', 'user.name', 'Test')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-qm', 'init')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('git worktree flow', () => {
  it('detects repo and default branch', async () => {
    expect(await git.isGitRepo(repo)).toBe(true)
    expect(await git.defaultBranch(repo)).toBe('main')
  })

  it('creates a worktree on a new branch from base (no remote)', async () => {
    await git.addWorktree(repo, wt, 'feature/a', 'main')
    expect(existsSync(join(wt, 'a.txt'))).toBe(true)
    expect(await git.currentBranch(wt)).toBe('feature/a')
  })

  it('reports committed, modified and untracked changes vs base', async () => {
    writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\n')
    writeFileSync(join(wt, 'new.txt'), 'hello\n')
    const st = await git.status(wt, 'main')
    expect(st.dirty).toBe(true)
    expect(st.files.map((f) => [f.path, f.status])).toEqual([
      ['a.txt', 'M'],
      ['new.txt', 'A']
    ])
    const d = await git.diff(wt, 'main')
    expect(d).toContain('+TWO')
    expect(d).toContain('+hello')

    expect(await git.commitAll(wt, 'feat: change')).toContain('feat: change')
    const after = await git.status(wt, 'main')
    expect(after.dirty).toBe(false)
    expect(after.commitsAhead.map((c) => c.subject)).toEqual(['feat: change'])
    // committed changes still show in the branch diff
    expect(await git.diff(wt, 'main')).toContain('+TWO')
    expect(await git.commitAll(wt, 'noop')).toBe('Nothing to commit')
  })

  it('reverts a file to base', async () => {
    await git.discardFile(wt, 'a.txt', 'main')
    const d = await git.diff(wt, 'main', 'a.txt')
    expect(d).toBe('')
    await git.discardFile(wt, 'new.txt', 'main') // added on branch -> removed
    expect(existsSync(join(wt, 'new.txt'))).toBe(false)
  })

  it('merges base into the branch', async () => {
    writeFileSync(join(repo, 'b.txt'), 'from main\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'main change')
    await git.syncWithBase(wt, 'main')
    expect(existsSync(join(wt, 'b.txt'))).toBe(true)
  })

  it('pushes the branch to origin and tracks it', async () => {
    const bare = join(root, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', bare])
    sh(repo, 'remote', 'add', 'origin', bare)
    sh(repo, 'push', '-q', 'origin', 'main')
    writeFileSync(join(wt, 'c.txt'), 'c\n')
    await git.commitAll(wt, 'feat: c')
    await git.push(wt, 'feature/a')
    expect(sh(bare, 'branch', '--list', 'feature/a').trim()).toContain('feature/a')
    const st = await git.status(wt, 'main')
    expect(st.ahead).toBe(0)
    expect(await git.githubRepo(repo)).toBeUndefined()
  })

  it('removes worktree and branch', async () => {
    await git.removeWorktree(repo, wt)
    expect(existsSync(wt)).toBe(false)
    await git.deleteBranch(repo, 'feature/a')
    expect(sh(repo, 'branch', '--list', 'feature/a').trim()).toBe('')
  })
})
