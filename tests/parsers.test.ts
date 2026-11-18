import { describe, expect, it } from 'vitest'
import { ClaudeStreamParser, summarizeTool } from '../src/main/agents/claudeParser'
import { CodexStreamParser } from '../src/main/agents/codexParser'
import { claudeArgs, codexArgs } from '../src/main/agents'
import { parseUnifiedDiff } from '../src/shared/diff'
import { lastErrors, levelOf } from '../src/shared/laravelLog'
import { parseGithubRemote, setEnvValue, slugify } from '../src/shared/util'
import { parseNumstat, parsePorcelain } from '../src/main/git'
import { parseHerdTable } from '../src/main/herd'
import { mapCheck } from '../src/main/github'
import type { Feature, Settings } from '../src/shared/types'

const j = (o: unknown) => JSON.stringify(o)

describe('ClaudeStreamParser', () => {
  it('maps text, tool_use, tool_result and result events', () => {
    const p = new ClaudeStreamParser()
    expect(p.feed(j({ type: 'system', subtype: 'init', session_id: 'abc' })).sessionId).toBe('abc')
    const a = p.feed(
      j({
        type: 'assistant',
        session_id: 'abc',
        message: {
          id: 'msg_1',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'php artisan test' } }
          ]
        }
      })
    )
    expect(a.items).toHaveLength(2)
    expect(a.items[0]).toMatchObject({ role: 'assistant', text: 'Let me check.' })
    expect(a.items[1].tool).toMatchObject({ name: 'Bash', summary: 'php artisan test', status: 'running' })

    const u = p.feed(
      j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'OK (3 tests)' }] }] } })
    )
    expect(u.items[0].id).toBe('tu_1')
    expect(u.items[0].tool).toMatchObject({ status: 'ok', output: 'OK (3 tests)' })

    const r = p.feed(j({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'abc', total_cost_usd: 0.12 }))
    expect(r.done).toEqual({ costUsd: 0.12, error: undefined })
  })

  it('reports errors and closes dangling tools on result', () => {
    const p = new ClaudeStreamParser()
    p.feed(j({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Edit', input: { file_path: 'a.php' } }] } }))
    const r = p.feed(j({ type: 'result', subtype: 'error_max_turns', is_error: true }))
    expect(r.done?.error).toBe('error_max_turns')
    expect(r.items[0].tool?.status).toBe('error')
  })

  it('ignores garbage lines', () => {
    expect(new ClaudeStreamParser().feed('not json').items).toEqual([])
  })

  it('summarizes todo lists', () => {
    expect(summarizeTool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] })).toBe('✓ a  → b')
  })
})

describe('CodexStreamParser', () => {
  it('maps thread, command, file change, message and turn events', () => {
    const p = new CodexStreamParser('run1')
    expect(p.feed(j({ type: 'thread.started', thread_id: 'th_9' })).sessionId).toBe('th_9')
    const s = p.feed(j({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'ls', status: 'in_progress' } }))
    expect(s.items[0]).toMatchObject({ id: 'run1-item_0', role: 'tool' })
    expect(s.items[0].tool?.status).toBe('running')
    const c = p.feed(
      j({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'ls', aggregated_output: 'a\nb', exit_code: 0, status: 'completed' } })
    )
    expect(c.items[0].tool).toMatchObject({ status: 'ok', output: 'a\nb' })
    const failed = p.feed(
      j({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'false', exit_code: 1, status: 'failed' } })
    )
    expect(failed.items[0].tool?.status).toBe('error')
    const fc = p.feed(j({ type: 'item.completed', item: { id: 'item_2', type: 'file_change', changes: [{ path: 'app/X.php', kind: 'update' }], status: 'completed' } }))
    expect(fc.items[0].tool?.summary).toBe('update app/X.php')
    const m = p.feed(j({ type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Done!' } }))
    expect(m.items[0]).toMatchObject({ role: 'assistant', text: 'Done!' })
    expect(p.feed(j({ type: 'turn.completed', usage: {} })).done).toEqual({})
    expect(p.feed(j({ type: 'turn.failed', error: { message: 'boom' } })).done).toEqual({ error: 'boom' })
  })
})

const baseFeature: Feature = {
  id: 'f',
  kind: 'feature',
  projectId: 'p',
  title: 'T',
  slug: 't',
  branch: 'feature/t',
  baseBranch: 'main',
  worktreePath: '/tmp/wt',
  inPlace: false,
  agent: 'claude',
  permissionMode: 'acceptEdits',
  stage: 'coding',
  createdAt: 0,
  updatedAt: 0
}
const settings = { claudeModel: '', codexModel: '' } as Settings

describe('agent CLI args', () => {
  it('builds claude args with resume and model', () => {
    const a = claudeArgs({ ...baseFeature, sessionId: 's1', model: 'opus' }, settings, 'ctx')
    expect(a).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--resume', 's1', '--model', 'opus']))
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
  })

  it('puts codex -C/--sandbox before the resume subcommand and reads stdin', () => {
    const a = codexArgs({ ...baseFeature, agent: 'codex', sessionId: 'th_1' }, settings)
    expect(a[0]).toBe('exec')
    expect(a).toContain('--json')
    expect(a.indexOf('-C')).toBeLessThan(a.indexOf('resume'))
    expect(a.indexOf('--sandbox')).toBeLessThan(a.indexOf('resume'))
    expect(a).not.toContain('--full-auto')
    expect(a.slice(-3)).toEqual(['resume', 'th_1', '-'])
  })

  it('maps codex permission modes', () => {
    expect(codexArgs({ ...baseFeature, permissionMode: 'plan' }, settings)).toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
    expect(codexArgs({ ...baseFeature, permissionMode: 'bypassPermissions' }, settings)).toContain('--dangerously-bypass-approvals-and-sandbox')
  })
})

describe('diff parser', () => {
  const diff = `diff --git a/app/A.php b/app/A.php
index 1..2 100644
--- a/app/A.php
+++ b/app/A.php
@@ -1,3 +1,4 @@
 <?php
-old
+new
+added
 end
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
`
  it('parses files, statuses and line numbers', () => {
    const files = parseUnifiedDiff(diff)
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['app/A.php', 'modified', 2, 1],
      ['new.txt', 'added', 1, 0]
    ])
    const lines = files[0].hunks[0].lines
    expect(lines[1]).toMatchObject({ kind: 'del', oldNo: 2 })
    expect(lines[2]).toMatchObject({ kind: 'add', newNo: 2 })
    expect(lines[4]).toMatchObject({ kind: 'ctx', oldNo: 3, newNo: 4 })
  })
})

describe('git output parsers', () => {
  it('parses numstat including renames and binaries', () => {
    const m = parseNumstat('3\t1\tapp/A.php\n-\t-\timg.png\n2\t0\tsrc/{old => new}/x.ts\n')
    expect(m.get('app/A.php')).toEqual({ a: 3, d: 1 })
    expect(m.get('img.png')).toEqual({ a: 0, d: 0 })
    expect(m.get('src/new/x.ts')).toEqual({ a: 2, d: 0 })
  })
  it('parses porcelain', () => {
    expect(parsePorcelain(' M app/A.php\n?? new.txt\nR  a.txt -> b.txt\n')).toEqual([
      { path: 'app/A.php', status: 'M' },
      { path: 'new.txt', status: '??' },
      { path: 'b.txt', status: 'R' }
    ])
  })
})

describe('herd table parser', () => {
  it('parses herd links output', () => {
    const out = `+------+-----+------------------+------------+-----+
| Site | SSL | URL              | Path       | PHP |
+------+-----+------------------+------------+-----+
| app  |  X  | https://app.test | /code/app  | 8.4 |
| api  |     | http://api.test  | /code/api  | 8.3 |
|      |     |                  |            |     |
`
    expect(parseHerdTable(out)).toEqual([
      { site: 'app', secured: true, url: 'https://app.test', path: '/code/app', php: '8.4' },
      { site: 'api', secured: false, url: 'http://api.test', path: '/code/api', php: '8.3' }
    ])
  })
})

describe('github check mapping', () => {
  it('maps check runs and status contexts to buckets', () => {
    expect(mapCheck({ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' }).bucket).toBe('pass')
    expect(mapCheck({ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }).bucket).toBe('fail')
    expect(mapCheck({ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS' }).bucket).toBe('pending')
    expect(mapCheck({ __typename: 'CheckRun', name: 'x', status: 'COMPLETED', conclusion: 'SKIPPED' }).bucket).toBe('skipping')
    expect(mapCheck({ __typename: 'StatusContext', context: 'ci/x', state: 'ERROR' }).bucket).toBe('fail')
  })
})

describe('utils', () => {
  it('slugifies including Norwegian letters', () => {
    expect(slugify('Fiks bug på Faktura-eksport (ÆØÅ)!')).toBe('fiks-bug-pa-faktura-eksport-aeoa')
    expect(slugify('')).toBe('feature')
  })
  it('parses github remotes', () => {
    expect(parseGithubRemote('git@github.com:acme/shop.git')).toBe('acme/shop')
    expect(parseGithubRemote('https://github.com/acme/shop')).toBe('acme/shop')
    expect(parseGithubRemote('https://gitlab.com/acme/shop.git')).toBeUndefined()
  })
  it('sets env values', () => {
    expect(setEnvValue('APP_NAME=x\nAPP_URL=http://old.test\n', 'APP_URL', 'https://new.test')).toBe('APP_NAME=x\nAPP_URL=https://new.test\n')
    expect(setEnvValue('APP_NAME=x', 'APP_URL', 'https://a.test')).toBe('APP_NAME=x\nAPP_URL=https://a.test\n')
    expect(setEnvValue('APP_URL=a\n', 'APP_URL', 'http://x.test/$1')).toBe('APP_URL=http://x.test/$1\n')
  })
  it('extracts laravel errors', () => {
    const log = `[2026-01-01 10:00:00] local.INFO: hi
[2026-01-01 10:00:01] local.ERROR: Boom {"exception":"x"}
#0 /app/X.php(10)
[2026-01-01 10:00:02] local.WARNING: careful`
    expect(lastErrors(log)).toEqual(['[2026-01-01 10:00:01] local.ERROR: Boom {"exception":"x"}\n#0 /app/X.php(10)'])
    expect(levelOf('[2026-01-01 10:00:02] production.CRITICAL: x')).toBe('error')
  })
})
