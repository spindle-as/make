import type { ChatItem } from '@shared/types'
import { truncate } from '@shared/util'

export interface ParseOutput {
  items: ChatItem[] // upserts
  sessionId?: string
  /** Claude Code's init event: what it has loaded for this session */
  init?: { version?: string; model?: string; outputStyle?: string; slashCommands: string[]; agents: string[]; skills: string[]; mcpServers: { name: string; status: string }[]; plugins: string[] }
  done?: { costUsd?: number; error?: string }
}

/** Short human summary of a tool call, used as the collapsed row label. */
export function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Bash':
      return s('command') || s('description')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return s('file_path') || s('notebook_path')
    case 'Glob':
    case 'Grep':
      return s('pattern') + (s('path') ? ` in ${s('path')}` : '')
    case 'WebFetch':
      return s('url')
    case 'WebSearch':
      return s('query')
    case 'Task':
    case 'Agent':
      return s('description') || s('prompt')
    case 'TodoWrite': {
      const todos = (input.todos as { content?: string; status?: string }[]) || []
      return todos.map((t) => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '→' : '·'} ${t.content}`).join('  ')
    }
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string') as string | undefined
      return first ?? ''
    }
  }
}

function contentToText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((x) => (typeof x === 'string' ? x : x?.type === 'text' ? x.text : x?.type === 'image' ? '[image]' : ''))
      .join('\n')
  }
  return c == null ? '' : JSON.stringify(c)
}

/** Stateful parser for `claude -p --output-format stream-json --verbose`. */
interface StreamBlock {
  id: string
  kind: 'text' | 'thinking'
  text: string
  finalized: boolean
}

export class ClaudeStreamParser {
  private tools = new Map<string, ChatItem>()
  /** partial-message streaming state: message id -> block index -> block */
  private streams = new Map<string, Map<number, StreamBlock>>()
  private currentMsg = ''
  private seq = 0
  /** whether this turn produced any top-level reply text (local slash commands don't) */
  private repliedThisTurn = false

  /** Pick a stable id for a finished block so it replaces the streamed version in place. */
  private finalId(msgId: string, kind: 'text' | 'thinking', text: string): string {
    const blocks = [...(this.streams.get(msgId)?.values() ?? [])].filter((b) => b.kind === kind && !b.finalized)
    const match = blocks.find((b) => b.text.trim() === text.trim()) ?? blocks[0]
    if (match) {
      match.finalized = true
      return match.id
    }
    return `${msgId}-f${this.seq++}`
  }

  feed(line: string): ParseOutput {
    const out: ParseOutput = { items: [] }
    let j: Record<string, any>
    try {
      j = JSON.parse(line)
    } catch {
      return out
    }
    if (j.session_id) out.sessionId = j.session_id
    const now = Date.now()
    // Items from inside a subagent carry the id of the Task/Agent call that spawned it.
    const parentId: string | undefined = typeof j.parent_tool_use_id === 'string' && j.parent_tool_use_id ? j.parent_tool_use_id : undefined

    if (j.type === 'system' && j.subtype === 'init') {
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      out.init = {
        version: j.claude_code_version,
        model: j.model,
        outputStyle: j.output_style,
        slashCommands: strs(j.slash_commands).filter((c) => !c.startsWith('__')),
        agents: strs(j.agents),
        skills: strs(j.skills),
        mcpServers: Array.isArray(j.mcp_servers) ? j.mcp_servers.map((m: { name: string; status: string }) => ({ name: String(m.name), status: String(m.status) })) : [],
        plugins: Array.isArray(j.plugins) ? j.plugins.map((p: { name: string }) => String(p.name)) : []
      }
      return out
    }
    if (j.type === 'system' && j.subtype === 'compact_boundary') {
      const pre = j.compact_metadata?.pre_tokens
      out.items.push({ id: `compact-${j.uuid ?? now}`, role: 'system', text: `Context compacted${pre ? ` (was ${Math.round(pre / 1000)}k tokens)` : ''} — earlier messages were summarised`, ts: now })
      return out
    }

    if (j.type === 'stream_event' && j.event && !j.parent_tool_use_id) {
      const e = j.event
      if (e.type === 'message_start') {
        this.currentMsg = e.message?.id ?? `m${this.seq++}`
        this.streams.set(this.currentMsg, new Map())
      } else if (e.type === 'content_block_delta' && this.currentMsg) {
        const kind = e.delta?.type === 'text_delta' ? 'text' : e.delta?.type === 'thinking_delta' ? 'thinking' : null
        if (kind) {
          const blocks = this.streams.get(this.currentMsg)!
          let b = blocks.get(e.index)
          if (!b) {
            b = { id: `${this.currentMsg}-${e.index}`, kind, text: '', finalized: false }
            blocks.set(e.index, b)
          }
          b.text += kind === 'text' ? (e.delta.text ?? '') : (e.delta.thinking ?? '')
          if (b.text.trim()) {
            out.items.push({ id: b.id, role: kind === 'text' ? 'assistant' : 'thinking', text: b.text, ts: now, status: 'running' })
          }
        }
      }
      return out
    }

    if (j.type === 'assistant' && j.message?.content) {
      const msgId = j.message.id || j.uuid || String(now)
      j.message.content.forEach((b: Record<string, any>) => {
        if (b.type === 'text' && b.text?.trim()) {
          if (!parentId) this.repliedThisTurn = true
          out.items.push({ id: this.finalId(msgId, 'text', b.text), role: 'assistant', text: b.text, ts: now, ...(parentId ? { parentId } : {}) })
        } else if (b.type === 'thinking' && b.thinking?.trim()) {
          out.items.push({ id: this.finalId(msgId, 'thinking', b.thinking), role: 'thinking', text: b.thinking, ts: now, ...(parentId ? { parentId } : {}) })
        } else if (b.type === 'tool_use') {
          const item: ChatItem = {
            id: b.id,
            role: 'tool',
            text: '',
            ts: now,
            ...(parentId ? { parentId } : {}),
            tool: {
              name: b.name,
              summary: truncate(summarizeTool(b.name, b.input), 300),
              input: truncate(JSON.stringify(b.input, null, 2), 20_000),
              status: 'running'
            }
          }
          this.tools.set(b.id, item)
          out.items.push(item)
        }
      })
    } else if (j.type === 'user' && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) {
        if (b.type !== 'tool_result') continue
        const existing = this.tools.get(b.tool_use_id)
        if (!existing?.tool) continue
        const updated: ChatItem = {
          ...existing,
          tool: {
            ...existing.tool,
            output: truncate(contentToText(b.content), 20_000),
            status: b.is_error ? 'error' : 'ok'
          }
        }
        this.tools.set(b.tool_use_id, updated)
        out.items.push(updated)
      }
    } else if (j.type === 'result') {
      // Anything still running at the end of a turn did not complete.
      for (const [id, t] of this.tools) {
        if (t.tool?.status === 'running') {
          const closed = { ...t, tool: { ...t.tool, status: 'error' as const } }
          this.tools.set(id, closed)
          out.items.push(closed)
        }
      }
      const isError = j.is_error || (j.subtype && j.subtype !== 'success')
      // Local slash commands (/context, /mcp, /usage, /recap …) answer only here, without an
      // assistant message — show that answer as the reply instead of dropping it.
      if (!isError && !this.repliedThisTurn && typeof j.result === 'string' && j.result.trim()) {
        out.items.push({ id: `result-${j.session_id ?? ''}-${this.seq++}`, role: 'assistant', text: j.result, ts: now })
      }
      this.repliedThisTurn = false
      out.done = {
        costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined,
        error: isError ? String(j.result || j.subtype || 'Agent error') : undefined
      }
    }
    return out
  }
}
