import type { ChatItem } from '@shared/types'
import { truncate } from '@shared/util'
import type { ParseOutput } from './claudeParser'

/**
 * Stateful parser for `codex exec --json` JSONL events.
 * Item ids from Codex ("item_0", ...) restart every turn, so they are
 * namespaced with a per-run prefix.
 */
export class CodexStreamParser {
  constructor(private prefix: string) {}

  private toItem(item: Record<string, any>, phase: 'started' | 'updated' | 'completed'): ChatItem | null {
    const id = `${this.prefix}-${item.id ?? Math.random().toString(36).slice(2)}`
    const ts = Date.now()
    const status = (s?: string, exit?: number | null): 'running' | 'ok' | 'error' => {
      if (phase !== 'completed' && s !== 'completed' && s !== 'failed') return 'running'
      if (s === 'failed' || s === 'declined' || (typeof exit === 'number' && exit !== 0)) return 'error'
      return 'ok'
    }
    switch (item.type ?? item.item_type) {
      case 'agent_message':
      case 'assistant_message':
        return item.text?.trim() ? { id, role: 'assistant', text: item.text, ts } : null
      case 'reasoning':
        return item.text?.trim() ? { id, role: 'thinking', text: item.text, ts } : null
      case 'command_execution':
        return {
          id,
          role: 'tool',
          text: '',
          ts,
          tool: {
            name: 'Bash',
            summary: truncate(String(item.command ?? ''), 300),
            input: String(item.command ?? ''),
            output: truncate(String(item.aggregated_output ?? ''), 20_000),
            status: status(item.status, item.exit_code)
          }
        }
      case 'file_change': {
        const changes = (item.changes as { path: string; kind: string }[]) ?? []
        return {
          id,
          role: 'tool',
          text: '',
          ts,
          tool: {
            name: 'Edit',
            summary: truncate(changes.map((c) => `${c.kind} ${c.path}`).join(', '), 300),
            input: JSON.stringify(changes, null, 2),
            status: status(item.status)
          }
        }
      }
      case 'mcp_tool_call':
        return {
          id,
          role: 'tool',
          text: '',
          ts,
          tool: {
            name: `${item.server ?? 'mcp'}.${item.tool ?? 'tool'}`,
            summary: truncate(JSON.stringify(item.arguments ?? {}), 300),
            input: JSON.stringify(item.arguments ?? {}, null, 2),
            output: item.result ? truncate(JSON.stringify(item.result), 20_000) : item.error?.message,
            status: status(item.status)
          }
        }
      case 'web_search':
        return {
          id,
          role: 'tool',
          text: '',
          ts,
          tool: { name: 'WebSearch', summary: String(item.query ?? ''), status: status(item.status ?? (phase === 'completed' ? 'completed' : undefined)) }
        }
      case 'todo_list': {
        const todos = (item.items as { text: string; completed: boolean }[]) ?? []
        return {
          id,
          role: 'tool',
          text: '',
          ts,
          tool: {
            name: 'TodoWrite',
            summary: todos.map((t) => `${t.completed ? '✓' : '·'} ${t.text}`).join('  '),
            // Same shape the checklist reads for Claude's TodoWrite.
            input: JSON.stringify({ items: todos }),
            status: phase === 'completed' ? 'ok' : 'running'
          }
        }
      }
      case 'error':
        return { id, role: 'error', text: String(item.message ?? 'error'), ts }
      default:
        return null
    }
  }

  feed(line: string): ParseOutput {
    const out: ParseOutput = { items: [] }
    let j: Record<string, any>
    try {
      j = JSON.parse(line)
    } catch {
      return out
    }
    switch (j.type) {
      case 'thread.started':
        out.sessionId = j.thread_id
        break
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const it = j.item ? this.toItem(j.item, j.type.split('.')[1]) : null
        if (it) out.items.push(it)
        break
      }
      case 'turn.completed':
        out.done = {}
        break
      case 'turn.failed':
        out.done = { error: j.error?.message ?? 'Turn failed' }
        break
      case 'error':
        out.items.push({ id: `${this.prefix}-err-${Date.now()}`, role: 'error', text: String(j.message ?? 'error'), ts: Date.now() })
        break
    }
    return out
  }
}
