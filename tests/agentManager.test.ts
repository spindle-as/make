import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AgentManager } from '../src/main/agents'
import type { AgentStatus, ChatItem, Feature, PendingRequest, Project, Settings } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'sf-agent-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Fake `claude` speaking the stream-json protocol: reads one user message line,
// asks for permission to run a tool, then echoes the prompt and the decision.
const fake = join(dir, 'fake-claude')
writeFileSync(
  fake,
  `#!/bin/sh
read -r msg
prompt=$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.load(sys.stdin)["message"]["content"][0]["text"])')
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"sess-1"}'
printf '%s\\n' '{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"${dir}/a.txt"}}]}}'
printf '%s\\n' '{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"${dir}/a.txt"},"permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Write"}],"behavior":"allow","destination":"localSettings"}]}}'
read -r answer
decision=$(printf '%s' "$answer" | python3 -c 'import json,sys; r=json.load(sys.stdin)["response"]; print(r["request_id"], r["response"]["behavior"], r["response"].get("updatedPermissions",[{}])[0].get("destination","-"))')
printf '%s\\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'
printf '{"type":"assistant","message":{"id":"m2","content":[{"type":"text","text":"echo: %s | %s"}]}}\\n' "$prompt" "$decision"
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"sess-1","total_cost_usd":0.5}'
`
)
chmodSync(fake, 0o755)

const project = { name: 'demo', isLaravel: false } as Project
const feature = {
  id: 'f1',
  kind: 'feature',
  title: 'T',
  slug: 't',
  branch: 'feature/t',
  baseBranch: 'main',
  worktreePath: dir,
  inPlace: false,
  agent: 'claude',
  permissionMode: 'acceptEdits',
  stage: 'coding'
} as Feature

function harness() {
  const items = new Map<string, ChatItem>()
  const statuses: AgentStatus[] = []
  const requests: PendingRequest[] = []
  let session = ''
  let cost = 0
  let resolveDone: (ok: boolean) => void
  const done = new Promise<boolean>((r) => (resolveDone = r))
  let mgr!: AgentManager
  mgr = new AgentManager({
    onRequest: (r) => {
      requests.push(r)
      // answer like the UI would: "always allow" for this session
      setTimeout(() => mgr.respondPermission(r.featureId, r.id, 'allow-always'), 10)
    },
    onRequestResolved: () => {},
    onItem: (_f, i) => items.set(i.id, i),
    onStatus: (s) => statuses.push(s),
    onSession: (_f, s) => (session = s),
    onCost: (_f, c) => (cost = c),
    onFinished: (_f, ok) => resolveDone(ok)
  })
  return { mgr, items, statuses, requests, done, get session() { return session }, get cost() { return cost } }
}

describe('AgentManager', () => {
  it('streams a full turn from the agent process', async () => {
    const h = harness()
    h.mgr.start(project, feature, { claudePath: fake } as Settings, 'build it')
    expect(h.mgr.isRunning('f1')).toBe(true)
    expect(await h.done).toBe(true)
    expect(h.session).toBe('sess-1')
    expect(h.cost).toBe(0.5)
    const list = [...h.items.values()]
    expect(list.find((i) => i.id === 't1')?.tool).toMatchObject({ status: 'ok', summary: 'a.txt' }) // made relative to worktree
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]).toMatchObject({ kind: 'permission', toolName: 'Write', title: 'Create a file' })
    // the approval travelled back over stdin, with "always" scoped to the session
    expect(list.find((i) => i.role === 'assistant')?.text).toBe('echo: build it | req-1 allow session')
    expect(h.statuses.at(-1)).toMatchObject({ running: false })
    expect(h.mgr.isRunning('f1')).toBe(false)
  })

  it('reports a missing binary without hanging', async () => {
    const h = harness()
    h.mgr.start(project, feature, { claudePath: join(dir, 'does-not-exist') } as Settings, 'x')
    expect(await h.done).toBe(false)
    const err = [...h.items.values()].find((i) => i.role === 'error')
    expect(err?.text).toMatch(/Failed to start/)
  })

  it('refuses a second concurrent run for the same feature', async () => {
    const h = harness()
    h.mgr.start(project, feature, { claudePath: fake } as Settings, 'one')
    expect(() => h.mgr.start(project, feature, { claudePath: fake } as Settings, 'two')).toThrow(/already running/)
    await h.done
  })
})

describe('permission protocol helpers', () => {
  it('builds request cards for tools and questions', async () => {
    const { toPendingRequest, permissionResponse, questionResponse } = await import('../src/main/agents')
    const bash = toPendingRequest('f', { request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'npm i' } } })!
    expect(bash).toMatchObject({ kind: 'permission', title: 'Run a command', detail: 'npm i' })
    expect(permissionResponse(bash, 'deny', 'use pnpm')).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { behavior: 'deny', message: 'use pnpm' } }
    })
    const q = toPendingRequest('f', {
      request_id: 'r2',
      request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Tea?', header: 'Drink', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] }] } }
    })!
    expect(q.kind).toBe('question')
    expect(q.questions?.[0].options.map((o) => o.label)).toEqual(['Yes', 'No'])
    const resp = questionResponse(q, { 'Tea?': 'No' }) as { response: { response: { updatedInput: { answers: Record<string, string> } } } }
    expect(resp.response.response.updatedInput.answers).toEqual({ 'Tea?': 'No' })
    expect(toPendingRequest('f', { request_id: 'x', request: { subtype: 'hook_callback' } })).toBeNull()
  })
})
