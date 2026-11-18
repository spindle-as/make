import clsx from 'clsx'
import { Check, ChevronRight, CircleDashed, ExternalLink, GitMerge, GitPullRequest, Lock, RefreshCw, ShieldCheck, Sparkles, Wand2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CheckResult, Feature, Project, PullRequestInfo } from '@shared/types'
import { EnvDeployCard } from '../components/DeployStatus'
import { RoleBadge } from '../components/OpenProject'
import { Badge, Button, Input, Segmented, Spinner, Textarea } from '../components/ui'
import { useWords } from '../lib/words'
import { act, useStore } from '../store'

const EMPTY: CheckResult[] = []

export function ChecksSection({ feature }: { feature: Feature }) {
  const w = useWords()
  const live = useStore((s) => s.checks[feature.id])
  const results = live?.results.length ? live.results : latest(feature.checks ?? EMPTY)
  const running = live?.running ?? false
  const [open, setOpen] = useState<string | null>(null)
  const failing = results.filter((r) => !r.ok)
  return (
    <section className="rounded-2xl border border-line bg-raised/40 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-hover text-sm font-semibold">1</span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">{w.checks}</div>
          <div className="text-sm text-muted">Runs the project’s tests and quality checks on this change.</div>
        </div>
        <Button variant={results.length ? 'secondary' : 'primary'} loading={running} icon={<ShieldCheck className="size-4" />} onClick={() => void act(() => window.api.checkChanges(feature.id))}>
          {results.length ? 'Check again' : w.checks}
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {results.map((r) => (
            <li key={r.name}>
              <button type="button" onClick={() => setOpen(open === r.name ? null : r.name)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
                {r.ok ? <Check className="size-4 text-ok" /> : <X className="size-4 text-bad" />}
                <span className="text-sm">{r.name}</span>
                <code className="truncate font-mono text-xs text-faint">{r.command}</code>
                <span className="ml-auto text-xs text-faint">{r.ok ? 'passed' : 'needs fixing'}</span>
                <ChevronRight className={clsx('size-4 text-faint transition-transform', open === r.name && 'rotate-90')} />
              </button>
              {open === r.name && <pre className="selectable mx-2 mb-2 max-h-56 overflow-auto rounded-lg bg-bg p-2.5 font-mono text-xs whitespace-pre-wrap text-muted">{r.summary}</pre>}
            </li>
          ))}
          {running && (
            <li className="flex items-center gap-2.5 px-2 py-1.5 text-sm text-muted">
              <Spinner /> Checking…
            </li>
          )}
        </ul>
      )}
      {failing.length > 0 && !running && (
        <Button
          className="mt-2"
          size="sm"
          variant="ghost"
          icon={<Wand2 className="size-4" />}
          onClick={() =>
            act(
              () =>
                window.api.sendPrompt(
                  feature.id,
                  `These checks failed:\n\n${failing.map((f) => `### ${f.name} (\`${f.command}\`, exit ${f.code})\n\`\`\`\n${f.summary}\n\`\`\``).join('\n\n')}\n\nFix the causes without weakening the checks, then run them again to confirm.`
                ),
              'Sent to the AI'
            )
          }
        >
          Fix with AI
        </Button>
      )}
    </section>
  )
}

function latest(all: CheckResult[]): CheckResult[] {
  const m = new Map<string, CheckResult>()
  for (const c of [...all].sort((a, b) => a.at - b.at)) m.set(c.name, c)
  return [...m.values()]
}

export function ReviewPanel({ feature, project }: { feature: Feature; project: Project }) {
  const w = useWords()
  const access = project.access
  const [pr, setPr] = useState<PullRequestInfo | null>(null)
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<'preview' | 'edit'>('preview')

  const refresh = useCallback(async () => {
    if (!project.githubRepo || feature.inPlace) return
    setPr(await window.api.getPr(feature.id).catch(() => null))
  }, [feature.id, project.githubRepo, feature.inPlace])

  useEffect(() => {
    void refresh()
  }, [refresh, feature.stage])
  useEffect(() => {
    if (!access) void window.api.refreshAccess(project.id).catch(() => {})
  }, [access, project.id])

  const prepare = async () => {
    setDrafting(true)
    const d = await act(() => window.api.draftPr(feature.id))
    if (d) setDraft(d)
    setDrafting(false)
  }

  const submit = async () => {
    if (!draft) return
    setBusy('submit')
    const r = await act(() => window.api.createPr(feature.id, { title: draft.title, body: draft.body, draft: false }), 'Submitted for review')
    if (r) {
      setPr(r)
      setDraft(null)
    }
    setBusy('')
  }

  const merge = async () => {
    if (!pr) return
    const failing = pr.checks.filter((c) => c.bucket === 'fail')
    if (failing.length && !confirm(`${failing.length} automatic check(s) failed on GitHub. ${w.merge} anyway?`)) return
    setBusy('merge')
    await act(() => window.api.mergePr(feature.id), 'Changes applied')
    setBusy('')
    void refresh()
  }

  const ciPending = pr?.checks.some((c) => c.bucket === 'pending')
  useEffect(() => {
    if (!ciPending) return
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [ciPending, refresh])

  if (!project.githubRepo) {
    return <div className="p-6 text-sm text-muted">This project isn’t connected to GitHub, so it can’t be submitted for review. Add a GitHub repository in project settings.</div>
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-raised/50 px-3 py-2.5 text-sm">
        <Lock className="size-4 text-muted" />
        <span className="text-muted">
          {access ? (
            <>
              Signed in as <span className="text-fg">{access.login ?? 'unknown'}</span>
            </>
          ) : (
            'Checking your access…'
          )}
        </span>
        {access && <RoleBadge role={access.role} />}
        <span className="ml-auto text-xs text-faint">
          {access?.role === 'contributor'
            ? 'You submit from your own copy; an engineer approves.'
            : access?.canDeploy
              ? 'You can approve and go live.'
              : access?.canMerge
                ? 'You can approve; going live is up to a maintainer.'
                : ''}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <ChecksSection feature={feature} />

        <section className="rounded-2xl border border-line bg-raised/40 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-hover text-sm font-semibold">2</span>
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium">{w.submit}</div>
              <div className="text-sm text-muted">{pr ? 'Submitted — an engineer reviews it on GitHub.' : 'Spindle writes a clear description of what changed, with the check results.'}</div>
            </div>
            {!pr && !draft && (
              <Button variant="primary" icon={<Sparkles className="size-4" />} loading={drafting} onClick={prepare}>
                Prepare submission
              </Button>
            )}
            {pr && (
              <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={refresh}>
                Refresh
              </Button>
            )}
          </div>

          {drafting && <div className="mt-3 text-sm text-faint">Writing the description from the changes and check results…</div>}

          {draft && !pr && (
            <div className="mt-4 flex flex-col gap-3">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-10 text-base font-medium" aria-label="Title" />
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'preview', label: 'Preview' },
                  { value: 'edit', label: 'Edit' }
                ]}
              />
              {tab === 'edit' ? (
                <Textarea rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="font-mono text-xs" />
              ) : (
                <div className="prose-chat max-h-[420px] overflow-y-auto rounded-xl border border-line bg-bg/50 px-4 py-2 text-sm">
                  <Markdown remarkPlugins={[remarkGfm]}>{draft.body}</Markdown>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button variant="ghost" icon={<Sparkles className="size-4" />} loading={drafting} onClick={prepare}>
                  Rewrite
                </Button>
                <div className="flex-1" />
                <Button variant="primary" size="lg" icon={<GitPullRequest className="size-5" />} loading={busy === 'submit'} onClick={submit}>
                  {w.submit}
                </Button>
              </div>
            </div>
          )}

          {pr && (
            <div className="mt-4 rounded-xl border border-line bg-bg/40 p-3">
              <div className="flex items-center gap-2">
                <GitPullRequest className={clsx('size-4', pr.state === 'MERGED' ? 'text-accent' : pr.state === 'OPEN' ? 'text-ok' : 'text-bad')} />
                <span className="truncate text-sm font-medium">{pr.title}</span>
                <Badge tone={pr.state === 'MERGED' ? 'accent' : pr.state === 'OPEN' ? 'ok' : 'bad'}>{pr.state === 'MERGED' ? 'applied' : pr.state === 'OPEN' ? 'in review' : 'closed'}</Badge>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => void window.api.openExternal(pr.url)}>
                  Open on GitHub
                </Button>
              </div>
              {pr.checks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {pr.checks.map((c, i) => (
                    <span key={i} className={clsx('flex items-center gap-1 rounded-md px-2 py-0.5', c.bucket === 'pass' ? 'bg-ok/10 text-ok' : c.bucket === 'fail' ? 'bg-bad/10 text-bad' : 'bg-hover text-muted')}>
                      {c.bucket === 'pass' ? <Check className="size-3" /> : c.bucket === 'fail' ? <X className="size-3" /> : <CircleDashed className="size-3" />}
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
              {pr.reviewDecision && <div className="mt-2 text-xs text-muted">Review: {pr.reviewDecision.replace('_', ' ').toLowerCase()}</div>}
            </div>
          )}
        </section>

        {pr?.state === 'OPEN' && access?.canMerge && (
          <section className="rounded-2xl border border-line bg-raised/40 p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-hover text-sm font-semibold">3</span>
              <div className="min-w-0 flex-1">
                <div className="text-base font-medium">{w.merge}</div>
                <div className="text-sm text-muted">Adds the change to the main version of the project. GitHub’s own rules still apply.</div>
              </div>
              <Button variant="success" icon={<GitMerge className="size-4" />} loading={busy === 'merge'} onClick={merge} disabled={pr.isDraft || pr.mergeable === 'CONFLICTING'}>
                {w.merge}
              </Button>
            </div>
          </section>
        )}

        {access?.canDeploy && project.environments.length > 0 && (feature.stage === 'merged' || feature.stage === 'deployed') && (
          <section className="flex flex-col gap-2">
            <div className="px-1 text-xs font-semibold tracking-wider text-faint uppercase">{w.deploy}</div>
            {project.environments.map((e) => (
              <EnvDeployCard key={e.id} project={project} env={e} feature={feature} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
