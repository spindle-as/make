import type { ChatItem } from '@shared/types'

/** Parse a TodoWrite call's todos (Claude) or a Codex todo list summary. */
export function todosOf(item: ChatItem): { content: string; status: 'pending' | 'in_progress' | 'completed' }[] {
  try {
    const input = JSON.parse(item.tool?.input ?? '{}') as { todos?: { content?: string; activeForm?: string; status?: string }[]; items?: { text: string; completed: boolean }[] }
    if (Array.isArray(input.todos)) return input.todos.map((t) => ({ content: (t.status === 'in_progress' && t.activeForm) || t.content || '', status: (t.status as never) ?? 'pending' }))
    if (Array.isArray(input.items)) return input.items.map((t) => ({ content: t.text, status: t.completed ? 'completed' : 'pending' }))
  } catch {
    /* not JSON */
  }
  return []
}

export type PlanItem = { content: string; status: 'pending' | 'in_progress' | 'completed' }

const PLAN_TOOLS = new Set(['TodoWrite', 'todo_list', 'TaskCreate', 'TaskUpdate'])
export const isPlanTool = (item: ChatItem) => !item.parentId && !!item.tool && PLAN_TOOLS.has(item.tool.name)

/**
 * The agent's current plan, folded from every plan tool call in the thread: Claude Code's
 * TaskCreate/TaskUpdate (newer) or TodoWrite (older), and Codex's todo list. `anchorId` is the
 * latest call that changed it — where the checklist is shown.
 */
export function planFrom(items: ChatItem[]): { todos: PlanItem[]; anchorId?: string } {
  let todos: (PlanItem & { id?: string })[] = []
  let anchorId: string | undefined
  for (const it of items) {
    if (!isPlanTool(it)) continue
    const name = it.tool!.name
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(it.tool!.input ?? '{}')
    } catch {
      /* keep {} */
    }
    if (name === 'TodoWrite' || name === 'todo_list') {
      todos = todosOf(it)
    } else if (name === 'TaskCreate') {
      if (it.tool!.status === 'error') continue
      const id = it.tool!.output?.match(/#(\d+)/)?.[1] ?? String(todos.length + 1)
      todos = [...todos, { id, content: String(input.subject ?? input.description ?? ''), status: 'pending' }]
    } else if (name === 'TaskUpdate') {
      const id = String(input.taskId ?? '')
      if (input.status === 'deleted') todos = todos.filter((t) => t.id !== id)
      else
        todos = todos.map((t) =>
          t.id === id
            ? {
                ...t,
                status: (['pending', 'in_progress', 'completed'].includes(String(input.status)) ? input.status : t.status) as PlanItem['status'],
                content: String((input.status === 'in_progress' && input.activeForm) || input.subject || t.content)
              }
            : t
        )
    }
    anchorId = it.id
  }
  return { todos: todos.map(({ content, status }) => ({ content, status })), anchorId }
}
