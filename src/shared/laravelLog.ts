/** Split a Laravel log blob into entries (each starts with "[YYYY-MM-DD HH:MM:SS]"). */
export function logEntries(log: string): string[] {
  return log.split(/\n(?=\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/).filter((e) => e.trim())
}

/** Last N error-level entries, each trimmed to its first 25 lines (message + stack head). */
export function lastErrors(log: string, max = 5): string[] {
  return logEntries(log)
    .filter((e) => /\.(ERROR|CRITICAL|ALERT|EMERGENCY):/.test(e))
    .slice(-max)
    .map((e) => e.split('\n').slice(0, 25).join('\n'))
}

export function levelOf(line: string): 'error' | 'warn' | 'info' | 'debug' | null {
  const m = line.match(/^\[[^\]]+\] \w+\.(\w+):/)
  if (!m) return null
  const l = m[1].toUpperCase()
  if (['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'].includes(l)) return 'error'
  if (l === 'WARNING') return 'warn'
  if (l === 'DEBUG') return 'debug'
  return 'info'
}
