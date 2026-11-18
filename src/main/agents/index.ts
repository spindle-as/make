import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentQuestion, AgentStatus, Attachment, ChatItem, Feature, PendingRequest, PermissionDecision, Project, Settings } from '@shared/types'
import { uid } from '@shared/util'
import { ClaudeStreamParser, type ParseOutput } from './claudeParser'
import { CodexStreamParser } from './codexParser'

export interface AgentHooks {
  onItem(featureId: string, item: ChatItem): void
  onRequest(req: PendingRequest): void
  onRequestResolved(featureId: string, id: string): void
  onStatus(status: AgentStatus): void
  onSession(featureId: string, sessionId: string): void
  onCost(featureId: string, costUsd: number): void
  onFinished(featureId: string, ok: boolean): void
}

interface Running {
  child: ChildProcess
  stopped: boolean
  /** Claude in streaming-input mode: stdin stays open for answers and mid-turn messages */
  interactive: boolean
  pending: Map<string, PendingRequest>
  /** user messages written after the turn started; keeps stdin open past the next result */
  queued: number
  closeTimer?: NodeJS.Timeout
}

/** Context injected into every turn so the agent knows where it is and what not to do. */
export function systemContext(project: Project | null, feature: Feature, extra = ''): string {
  if (feature.kind === 'chat') {
    return [
      project
        ? `You are chatting with the user about the project "${project.name}" (checkout at ${feature.worktreePath}). Answer questions, explain code, and help plan work.`
        : 'You are a helpful engineering assistant chatting with the user. There is no project attached to this conversation.',
      project ? 'Only modify files if the user explicitly asks you to. Never push, open pull requests, merge or deploy.' : '',
      project?.isLaravel ? 'This is a Laravel app.' : '',
      'If something is ambiguous, ask the user with the AskUserQuestion tool instead of guessing.',
      extra
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (!project) throw new Error('A feature thread needs a project')
  return [
    `You are working on the feature "${feature.title}" in the project "${project.name}".`,
    feature.inPlace
      ? `You are in the main checkout at ${feature.worktreePath} on branch ${feature.branch}.`
      : `You are in an isolated git worktree at ${feature.worktreePath} on branch ${feature.branch} (base: ${feature.baseBranch}). Other features are being developed in parallel in other worktrees — only touch files in this directory.`,
    feature.localUrl ? `The app is served locally at ${feature.localUrl} — the user tests there.` : '',
    project.isLaravel ? 'This is a Laravel app. Prefer `php artisan` generators, follow existing conventions, and run the relevant tests (`php artisan test --filter=...`) after changes.' : '',
    'The user ships from Software Factory: do NOT push, open pull requests, merge, or deploy yourself. Committing is optional; leaving changes uncommitted is fine.',
    'When a decision is genuinely ambiguous (product behaviour, naming, a trade-off), ask the user with the AskUserQuestion tool instead of guessing. Otherwise keep going autonomously.',
    extra
  ]
    .filter(Boolean)
    .join('\n')
}

export function claudeArgs(feature: Feature, settings: Settings, system: string, disallowedTools: string[] = []): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Streaming input + stdio permission prompts let the user approve tools and answer questions live.
    '--input-format',
    'stream-json',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    feature.permissionMode
  ]
  const model = feature.model ?? settings.claudeModel
  if (model) args.push('--model', model)
  const effort = feature.effort ?? settings.claudeEffort
  if (effort) args.push('--effort', effort)
  if (feature.maxBudgetUsd && feature.maxBudgetUsd > 0) args.push('--max-budget-usd', String(feature.maxBudgetUsd))
  if (feature.sessionId) args.push('--resume', feature.sessionId)
  // Enforced by Claude Code itself: these tools are refused even if the model tries.
  if (disallowedTools.length) args.push('--disallowedTools', ...disallowedTools)
  args.push('--append-system-prompt', system)
  return args
}

export function codexArgs(feature: Feature, settings: Settings, images: string[] = []): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check', '-C', feature.worktreePath]
  for (const img of images) args.push('-i', img)
  const model = feature.model ?? settings.codexModel
  if (model) args.push('-m', model)
  const effort = feature.effort ?? settings.codexEffort
  if (effort) args.push('-c', `model_reasoning_effort="${effort.replace(/[^a-z]/gi, '')}"`)
  switch (feature.permissionMode) {
    case 'plan':
      args.push('--sandbox', 'read-only')
      break
    case 'bypassPermissions':
      args.push('--dangerously-bypass-approvals-and-sandbox')
      break
    case 'auto':
      args.push('--approve-for-me')
      break
    default:
      // --full-auto was removed from codex; workspace-write is the equivalent sandbox.
      args.push('--sandbox', 'workspace-write')
  }
  // -C / --sandbox are not global flags, so they must precede the `resume` subcommand.
  if (feature.sessionId) args.push('resume', feature.sessionId)
  args.push('-') // read prompt from stdin
  return args
}

/** Human label + detail for a tool approval card. */
export function describeTool(tool: string, input: Record<string, unknown>): { title: string; detail: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return { title: 'Run a command', detail: str('command') }
    case 'Write':
      return { title: 'Create a file', detail: str('file_path') }
    case 'Edit':
    case 'MultiEdit':
      return { title: 'Edit a file', detail: str('file_path') }
    case 'NotebookEdit':
      return { title: 'Edit a notebook', detail: str('notebook_path') }
    case 'WebFetch':
      return { title: 'Fetch a web page', detail: str('url') }
    case 'WebSearch':
      return { title: 'Search the web', detail: str('query') }
    case 'ExitPlanMode':
      return { title: 'Approve the plan', detail: str('plan') }
    default:
      return { title: `Use ${tool}`, detail: JSON.stringify(input, null, 2).slice(0, 2000) }
  }
}

/** Turn a CLI `control_request` (can_use_tool) into a request card. */
export function toPendingRequest(featureId: string, j: Record<string, any>): PendingRequest | null {
  const r = j.request
  if (!r || r.subtype !== 'can_use_tool') return null
  const input = (r.input ?? {}) as Record<string, unknown>
  if (r.tool_name === 'AskUserQuestion') {
    const questions = ((input.questions as AgentQuestion[]) ?? []).map((q) => ({
      question: q.question,
      header: q.header,
      multiSelect: !!q.multiSelect,
      options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description }))
    }))
    return { id: j.request_id, featureId, kind: 'question', toolName: r.tool_name, title: 'Question', detail: questions.map((q) => q.question).join('\n'), input, questions, createdAt: Date.now() }
  }
  const d = describeTool(r.tool_name, input)
  return {
    id: j.request_id,
    featureId,
    kind: 'permission',
    toolName: r.tool_name,
    title: r.display_name && r.tool_name !== 'Bash' ? r.display_name : d.title,
    detail: r.description && !d.detail ? r.description : d.detail,
    input,
    suggestions: Array.isArray(r.permission_suggestions) ? r.permission_suggestions : undefined,
    createdAt: Date.now()
  }
}

/** The control_response line that answers a permission request. */
export function permissionResponse(req: PendingRequest, decision: PermissionDecision, message?: string): Record<string, unknown> {
  const response =
    decision === 'deny'
      ? { behavior: 'deny', message: message?.trim() || 'The user declined this action.' }
      : {
          behavior: 'allow',
          updatedInput: req.input,
          // "Always" = the CLI's own suggested rules, scoped to this session only
          ...(decision === 'allow-always' && req.suggestions?.length
            ? { updatedPermissions: (req.suggestions as Record<string, unknown>[]).map((sg) => ({ ...sg, destination: 'session' })) }
            : {})
        }
  return { type: 'control_response', response: { subtype: 'success', request_id: req.id, response } }
}

/** The control_response line that answers an AskUserQuestion request. */
export function questionResponse(req: PendingRequest, answers: Record<string, string>): Record<string, unknown> {
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: req.id, response: { behavior: 'allow', updatedInput: { ...req.input, answers } } }
  }
}

export function userMessageLine(text: string, attachments: Attachment[] = []): string {
  const content = [
    ...attachments.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } })),
    { type: 'text', text }
  ]
  return JSON.stringify({ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content } }) + '\n'
}

/** Codex takes images as files. */
function writeImages(attachments: Attachment[]): string[] {
  if (!attachments.length) return []
  const dir = join(tmpdir(), 'spindle-images')
  mkdirSync(dir, { recursive: true })
  return attachments.map((a, i) => {
    const f = join(dir, `${Date.now()}-${i}.${a.mediaType === 'image/png' ? 'png' : 'jpg'}`)
    writeFileSync(f, Buffer.from(a.data, 'base64'))
    return f
  })
}

export class AgentManager {
  private running = new Map<string, Running>()
  private statuses = new Map<string, AgentStatus>()

  constructor(private hooks: AgentHooks) {}

  isRunning(featureId: string): boolean {
    return this.running.has(featureId)
  }

  allStatuses(): AgentStatus[] {
    return [...this.statuses.values()]
  }

  pending(): PendingRequest[] {
    return [...this.running.values()].flatMap((r) => [...r.pending.values()])
  }

  private setStatus(s: AgentStatus): void {
    this.statuses.set(s.featureId, s)
    this.hooks.onStatus(s)
  }

  private touchWaiting(featureId: string): void {
    const r = this.running.get(featureId)
    const cur = this.statuses.get(featureId)
    if (cur) this.setStatus({ ...cur, waiting: r?.pending.size ?? 0 })
  }

  /** Can a message be added to the running turn (instead of waiting for it to finish)? */
  canQueue(featureId: string): boolean {
    return !!this.running.get(featureId)?.interactive
  }

  /** Send a user message into a running interactive turn. */
  queueMessage(featureId: string, text: string, attachments: Attachment[] = []): void {
    const r = this.running.get(featureId)
    if (!r?.interactive) throw new Error('The agent is busy — wait for it to finish or stop it first.')
    if (r.closeTimer) {
      clearTimeout(r.closeTimer)
      r.closeTimer = undefined
    }
    r.queued++
    r.child.stdin?.write(userMessageLine(text, attachments))
  }

  respondPermission(featureId: string, requestId: string, decision: PermissionDecision, message?: string): void {
    const r = this.running.get(featureId)
    const req = r?.pending.get(requestId)
    if (!r || !req) throw new Error('This request is no longer waiting for an answer.')
    r.child.stdin?.write(JSON.stringify(permissionResponse(req, decision, message)) + '\n')
    r.pending.delete(requestId)
    this.hooks.onRequestResolved(featureId, requestId)
    this.touchWaiting(featureId)
  }

  answerQuestion(featureId: string, requestId: string, answers: Record<string, string>): void {
    const r = this.running.get(featureId)
    const req = r?.pending.get(requestId)
    if (!r || !req) throw new Error('This question is no longer waiting for an answer.')
    r.child.stdin?.write(JSON.stringify(questionResponse(req, answers)) + '\n')
    r.pending.delete(requestId)
    this.hooks.onRequestResolved(featureId, requestId)
    this.touchWaiting(featureId)
  }

  start(
    project: Project | null,
    feature: Feature,
    settings: Settings,
    prompt: string,
    extraContext = '',
    opts: { disallowedTools?: string[]; attachments?: Attachment[]; env?: Record<string, string> } = {}
  ): void {
    if (this.running.has(feature.id)) throw new Error('Agent is already running for this feature')
    const system = systemContext(project, feature, extraContext)
    let bin: string
    let args: string[]
    let parser: { feed(line: string): ParseOutput }
    const interactive = feature.agent !== 'codex'
    if (!interactive) {
      bin = settings.codexPath || 'codex'
      args = codexArgs(feature, settings, writeImages(opts.attachments ?? []))
      parser = new CodexStreamParser(uid('cx'))
    } else {
      bin = settings.claudePath || 'claude'
      args = claudeArgs(feature, settings, system, opts.disallowedTools ?? [])
      parser = new ClaudeStreamParser()
    }

    // Never hand credentials the app holds to the agent's environment.
    const { GH_TOKEN: _a, GITHUB_TOKEN: _b, PLOI_API_TOKEN: _c, PLOI_TOKEN: _d, ...safeEnv } = process.env
    const child = spawn(bin, args, {
      cwd: feature.worktreePath,
      env: { ...safeEnv, ...opts.env, SF_FEATURE: feature.slug, SF_LOCAL_URL: feature.localUrl ?? '' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const run: Running = { child, stopped: false, interactive, pending: new Map(), queued: 0 }
    this.running.set(feature.id, run)
    this.setStatus({ featureId: feature.id, running: true, sessionId: feature.sessionId, waiting: 0 })

    let buf = ''
    let stderr = ''
    let finished = false
    let error: string | undefined

    const prefix = feature.worktreePath.replace(/\/$/, '') + '/'
    const relative = (item: ChatItem): ChatItem =>
      item.tool ? { ...item, tool: { ...item.tool, summary: item.tool.summary.split(prefix).join('') } } : item

    const closeInput = () => {
      if (!child.stdin?.writableEnded) child.stdin?.end()
    }

    const handleLine = (line: string) => {
      if (interactive && line.startsWith('{"type":"control')) {
        let j: Record<string, any>
        try {
          j = JSON.parse(line)
        } catch {
          return
        }
        if (j.type === 'control_request') {
          const req = toPendingRequest(feature.id, j)
          if (req) {
            run.pending.set(req.id, req)
            this.hooks.onRequest(req)
            this.touchWaiting(feature.id)
          } else {
            // We only speak the permission part of the control protocol.
            child.stdin?.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: j.request_id, error: 'Not supported by Software Factory' } }) + '\n')
          }
        } else if (j.type === 'control_cancel_request' && run.pending.has(j.request_id)) {
          run.pending.delete(j.request_id)
          this.hooks.onRequestResolved(feature.id, j.request_id)
          this.touchWaiting(feature.id)
        }
        return
      }
      const o = parser.feed(line)
      for (const item of o.items) this.hooks.onItem(feature.id, relative(item))
      if (o.sessionId) this.hooks.onSession(feature.id, o.sessionId)
      if (o.done) {
        finished = true
        if (o.done.costUsd !== undefined) this.hooks.onCost(feature.id, o.done.costUsd)
        if (o.done.error) error = o.done.error
        if (interactive) {
          if (run.queued > 0) {
            // A message sent mid-turn may run as its own turn; give it a moment to start.
            run.queued = 0
            finished = false
            run.closeTimer = setTimeout(closeInput, 2500)
          } else closeInput()
        }
      } else if (run.closeTimer) {
        clearTimeout(run.closeTimer)
        run.closeTimer = undefined
      }
    }

    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) handleLine(line)
      }
    })
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
    })
    let closed = false
    child.on('error', (e) => {
      error = `Failed to start ${bin}: ${e.message}. Check the binary path in Settings.`
      // A spawn failure (e.g. ENOENT) may never emit 'close'; finalize ourselves.
      if (child.pid === undefined) finalize(null)
    })
    child.stdin!.on('error', () => {
      /* EPIPE if the agent exits before reading the prompt; reported via close */
    })
    const finalize = (code: number | null) => {
      if (closed) return
      closed = true
      if (run.closeTimer) clearTimeout(run.closeTimer)
      if (buf.trim()) handleLine(buf.trim())
      for (const id of run.pending.keys()) this.hooks.onRequestResolved(feature.id, id)
      run.pending.clear()
      this.running.delete(feature.id)
      if (run.stopped) {
        this.hooks.onItem(feature.id, { id: uid('sys'), role: 'system', text: 'Stopped by user', ts: Date.now() })
      } else if (error || (code !== 0 && !finished)) {
        const msg = error || stderr.trim().split('\n').slice(-15).join('\n') || `${bin} exited with code ${code}`
        this.hooks.onItem(feature.id, { id: uid('err'), role: 'error', text: msg, ts: Date.now() })
      }
      const ok = !run.stopped && !error && (code === 0 || finished)
      this.setStatus({ featureId: feature.id, running: false, waiting: 0, error: ok ? undefined : error })
      this.hooks.onFinished(feature.id, ok)
    }
    child.on('close', (code) => finalize(code))

    if (interactive) child.stdin!.write(userMessageLine(prompt, opts.attachments ?? []))
    else child.stdin!.end(feature.sessionId ? prompt : `${system}\n\n---\n\n${prompt}`)
  }

  stop(featureId: string): void {
    const r = this.running.get(featureId)
    if (!r) return
    r.stopped = true
    r.child.kill('SIGINT')
    setTimeout(() => {
      if (this.running.get(featureId) === r) r.child.kill('SIGKILL')
    }, 4000)
  }

  stopAll(): void {
    for (const id of this.running.keys()) this.stop(id)
  }
}
