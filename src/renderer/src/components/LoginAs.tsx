import clsx from 'clsx'
import { LogOut, Search, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AuthTarget } from '@shared/types'
import { useStore } from '../store'
import { Popover, Spinner } from './ui'

type User = { id: string; name: string; email: string | null; role: string | null }

/** Who each preview is logged in as (survives tab switches; a fresh preview starts unknown). */
const loggedIn = new Map<string, User | null>()

/**
 * "Log in as…": pick a user from the app's own database and the preview is logged in as them —
 * no typing passwords, no login form. Laravel apps only.
 */
export function LoginAs({ target, partition, url, onNavigate }: { target: AuthTarget; partition: string; url: string; onNavigate: (url: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<User[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [current, setCurrent] = useState<User | null>(loggedIn.get(partition) ?? null)
  const input = useRef<HTMLInputElement>(null)

  // Search as you type (debounced); the list comes from the database this preview uses.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      window.api
        .authUsers(target, query)
        .then((r) => {
          setUsers(r.users)
          setTotal(r.total)
          setError('')
          setActive(0)
        })
        .catch((e) => setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    }, users ? 180 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, JSON.stringify(target)])
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30)
  }, [open])

  const login = async (u: User) => {
    setBusy(u.id)
    try {
      const r = await window.api.loginAs(target, u.id, partition, url)
      loggedIn.set(partition, u)
      setCurrent(u)
      setOpen(false)
      // From a login/register page (or the start page), go where a logged-in user lands.
      const here = new URL(url)
      const next = /^\/(login|register|signin|sign-in)?\/?$/i.test(here.pathname) ? new URL(r.home, here.origin).href : url
      onNavigate(next)
      useStore.getState().toast('success', `Logged in as ${u.name || u.email || `user #${u.id}`}`)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }
  const logout = async () => {
    await window.api.logoutPreview(partition, url)
    loggedIn.set(partition, null)
    setCurrent(null)
    setOpen(false)
    onNavigate(url)
    useStore.getState().toast('info', 'Logged out')
  }

  const label = current ? current.name.split(' ')[0] || current.email || `#${current.id}` : 'Log in as'
  return (
    <div className="relative">
      <button
        type="button"
        data-popover-anchor
        onClick={() => setOpen(!open)}
        title="Log in as any user in this app’s database — no password needed"
        className={clsx(
          'press no-drag flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium',
          current ? 'bg-info/12 text-info hover:bg-info/20' : 'text-muted hover:bg-hover hover:text-fg',
          open && 'bg-hover text-fg'
        )}
      >
        <UserRound className="size-3.5" />
        <span className="max-w-28 truncate">{label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} placement="bottom" className="right-0 left-auto w-[360px]">
        <div className="flex flex-col gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-bg/60 px-2.5 focus-within:border-info/60">
            <Search className="size-3.5 text-faint" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (!users?.length) return
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : users.length - 1)) % users.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  void login(users[active])
                }
              }}
              placeholder="Search by name, email or id"
              aria-label="Search users"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </label>
          {error ? (
            <div className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>
          ) : !users ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
              <Spinner /> Reading users…
            </div>
          ) : users.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted">{total === 0 ? 'There are no users yet — sign up in the preview, or seed some sample data.' : 'No users match.'}</div>
          ) : (
            <ul className="-mx-1 max-h-72 overflow-y-auto" role="listbox" aria-label="Users">
              {users.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void login(u)}
                    className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === active ? 'bg-hover' : '')}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-muted">{(u.name || u.email || '?').slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{u.name || u.email || `User #${u.id}`}</span>
                      <span className="block truncate text-xs text-faint">{[u.email, `#${u.id}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    {u.role && <span className="shrink-0 rounded-md bg-hover px-1.5 py-0.5 text-2xs text-muted">{u.role}</span>}
                    {current?.id === u.id && <span className="size-2 shrink-0 rounded-full bg-info" aria-label="Logged in" />}
                    {busy === u.id && <Spinner />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-faint">
            <span>{users ? `${total} user${total === 1 ? '' : 's'} in this app’s database` : ''}</span>
            <button type="button" onClick={() => void logout()} className="flex items-center gap-1 text-muted hover:text-fg">
              <LogOut className="size-3.5" /> Log out
            </button>
          </div>
        </div>
      </Popover>
    </div>
  )
}
