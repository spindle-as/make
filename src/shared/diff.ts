export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  oldPath: string
  newPath: string
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  binary: boolean
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

const stripPrefix = (p: string) => p.replace(/^"?(a|b)\//, '').replace(/"$/, '')

/** Parse `git diff` unified output into files → hunks → numbered lines. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/)
      const a = m ? stripPrefix(m[1]) : ''
      const b = m ? stripPrefix(m[2]) : ''
      file = { oldPath: a, newPath: b, path: b || a, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [] }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    if (!hunk) {
      if (raw.startsWith('new file mode')) file.status = 'added'
      else if (raw.startsWith('deleted file mode')) file.status = 'deleted'
      else if (raw.startsWith('rename from ')) {
        file.status = 'renamed'
        file.oldPath = raw.slice(12)
      } else if (raw.startsWith('rename to ')) file.newPath = file.path = raw.slice(10)
      else if (raw.startsWith('Binary files')) file.binary = true
      else if (raw.startsWith('--- ')) {
        if (raw === '--- /dev/null') file.status = 'added'
      } else if (raw.startsWith('+++ ')) {
        if (raw === '+++ /dev/null') {
          file.status = 'deleted'
          file.path = file.oldPath
        } else file.path = file.newPath = stripPrefix(raw.slice(4))
      }
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      hunk = { header: raw, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (raw.startsWith('+')) {
      hunk.lines.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ })
      file.additions++
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ })
      file.deletions++
    } else if (raw.startsWith(' ')) {
      hunk.lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    } else if (raw.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', text: raw })
    }
  }
  return files
}
