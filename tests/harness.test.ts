import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeStreamParser } from '../src/main/agents/claudeParser'
import { claudeArgs, permissionResponse } from '../src/main/agents'
import { expandCodexPrompt, harnessView } from '../src/main/harness'
import type { Feature, PendingRequest, Settings } from '../src/shared/types'

const line = (o: unknown) => JSON.stringify(o)

describe('Claude Code harness events', () => {
  it('reads what Claude Code loaded from its init event', () => {
    const p = new ClaudeStreamParser()
    const o = p.feed(
      line({
        type: 'system',
        subtype: 'init',
        claude_code_version: '2.1.322',
        model: 'claude-opus-5-5',
        slash_commands: ['goal', 'compact', '__remote-workflow', 'deploy-check'],
        agents: ['Explore', 'reviewer'],
        skills: ['pdf'],
        mcp_servers: [{ name: 'nightwatch', status: 'needs-auth' }],
        plugins: [{ name: 'x', path: 'builtin' }],
        output_style: 'default'
      })
    )
    expect(o.init).toMatchObject({ version: '2.1.322', model: 'claude-opus-5-5', slashCommands: ['goal', 'compact', 'deploy-check'], agents: ['Explore', 'reviewer'], mcpServers: [{ name: 'nightwatch', status: 'needs-auth' }], plugins: ['x'] })
  })

  it('marks context compaction in the conversation', () => {
    const o = new ClaudeStreamParser().feed(line({ type: 'system', subtype: 'compact_boundary', uuid: 'u1', compact_metadata: { pre_tokens: 152000 } }))
    expect(o.items[0]).toMatchObject({ role: 'system', text: expect.stringMatching(/compacted \(was 152k tokens\)/) })
  })

  it('nests a subagent’s steps under the Task call that spawned it', () => {
    const p = new ClaudeStreamParser()
    p.feed(line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'task1', name: 'Task', input: { description: 'Find usages', subagent_type: 'Explore' } }] } }))
    const inner = p.feed(line({ type: 'assistant', parent_tool_use_id: 'task1', message: { id: 'm2', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'foo' } }, { type: 'text', text: 'Found 3' }] } }))
    expect(inner.items.map((i) => i.parentId)).toEqual(['task1', 'task1'])
    const top = p.feed(line({ type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'Done' }] } }))
    expect(top.items[0].parentId).toBeUndefined()
  })
})

describe('plans, fallback model', () => {
  const req = { id: 'r1', featureId: 'f', kind: 'permission', toolName: 'ExitPlanMode', title: 'Plan', detail: '', input: { plan: '1. do it' }, createdAt: 0 } as PendingRequest
  it('approving a plan leaves plan mode for auto-edit', () => {
    const r = permissionResponse(req, 'approve-plan') as { response: { response: { behavior: string; updatedPermissions: unknown[] } } }
    expect(r.response.response.behavior).toBe('allow')
    expect(r.response.response.updatedPermissions).toEqual([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])
  })
  it('passes the fallback model, but not when it equals the main model', () => {
    const f = { model: 'claude-opus-5-5', permissionMode: 'default' } as Feature
    expect(claudeArgs(f, { claudeFallbackModel: 'claude-sonnet-5-5' } as Settings, 'sys')).toContain('--fallback-model')
    expect(claudeArgs(f, { claudeFallbackModel: 'claude-opus-5-5' } as Settings, 'sys')).not.toContain('--fallback-model')
  })
})

describe('commands, skills and subagents for the menus', () => {
  const home = mkdtempSync(join(tmpdir(), 'sf-home-'))
  const root = mkdtempSync(join(tmpdir(), 'sf-proj-'))
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true })
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(home, '.claude', 'skills', 'pdf'), { recursive: true })
  mkdirSync(join(home, '.codex', 'prompts'), { recursive: true })
  writeFileSync(join(root, '.claude', 'commands', 'deploy-check.md'), '---\ndescription: Check deploy readiness\n---\nDo it')
  writeFileSync(join(root, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews diffs\n---\n')
  writeFileSync(join(home, '.claude', 'skills', 'pdf', 'SKILL.md'), '---\ndescription: Work with PDFs\n---\n')
  writeFileSync(join(home, '.codex', 'prompts', 'fix.md'), '---\ndescription: x\n---\nFix the bug in $1. Details: $ARGUMENTS')

  it('works from files before Claude Code has run', () => {
    const v = harnessView('claude', root, undefined, home)
    expect(v.live).toBe(false)
    expect(v.commands[0].name).toBe('goal')
    expect(v.commands.find((c) => c.name === 'deploy-check')).toMatchObject({ source: 'project', description: 'Check deploy readiness' })
    expect(v.commands.find((c) => c.name === 'pdf')).toMatchObject({ source: 'skill' })
    expect(v.agents).toEqual([{ name: 'reviewer', description: 'Reviews diffs', source: 'project' }])
  })

  it('uses Claude Code’s own list once known, hiding terminal-only commands', () => {
    const v = harnessView('claude', root, { slashCommands: ['goal', 'clear', 'deploy-check', 'acme:release'], agents: ['Explore', 'reviewer'], skills: ['pdf'], mcpServers: [], plugins: [], updatedAt: 0 }, home)
    expect(v.live).toBe(true)
    expect(v.commands.map((c) => c.name)).toEqual(['goal', 'deploy-check', 'acme:release'])
    expect(v.commands.find((c) => c.name === 'acme:release')?.source).toBe('plugin')
    expect(v.agents.map((a) => a.name)).toEqual(['Explore', 'reviewer'])
  })

  it('expands Codex custom prompts with arguments', () => {
    expect(expandCodexPrompt('/fix login.php the redirect loops', home)).toBe('Fix the bug in login.php. Details: login.php the redirect loops')
    expect(expandCodexPrompt('/unknown thing', home)).toBe('/unknown thing')
    expect(expandCodexPrompt('just text', home)).toBe('just text')
  })
})

import { planFrom } from '../src/renderer/src/lib/todos'
describe('the agent’s plan as one checklist', () => {
  const tool = (id: string, name: string, input: object, output = '', parentId?: string) => ({ id, role: 'tool' as const, text: '', ts: 0, parentId, tool: { name, summary: '', input: JSON.stringify(input), output, status: 'ok' as const } })
  it('folds Claude Code TaskCreate/TaskUpdate (format from a real run)', () => {
    const items = [
      tool('a', 'TaskCreate', { subject: 'Find route', description: 'Find route' }, 'Task #1 created successfully: Find route'),
      tool('b', 'TaskCreate', { subject: 'Summarise' }, 'Task #2 created successfully: Summarise'),
      tool('c', 'TaskUpdate', { taskId: '1', status: 'in_progress', activeForm: 'Finding the route' }, 'Updated task #1 status'),
      tool('x', 'TaskCreate', { subject: 'inside a subagent' }, 'Task #9 created', 'task1'),
      tool('d', 'TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 status')
    ]
    const p = planFrom(items)
    expect(p.anchorId).toBe('d')
    expect(p.todos).toEqual([
      { content: 'Finding the route', status: 'completed' },
      { content: 'Summarise', status: 'pending' }
    ])
  })
  it('reads older TodoWrite and Codex todo lists', () => {
    expect(planFrom([tool('t', 'TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', activeForm: 'Doing B', status: 'in_progress' }] })]).todos).toEqual([
      { content: 'A', status: 'completed' },
      { content: 'Doing B', status: 'in_progress' }
    ])
    expect(planFrom([tool('t', 'TodoWrite', { items: [{ text: 'X', completed: true }] })]).todos).toEqual([{ content: 'X', status: 'completed' }])
  })
})
