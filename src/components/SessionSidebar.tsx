import { useEffect, useMemo, useState } from 'react'
import { filterSessions, matchedInBody } from '../lib/search'
import { type CanvasSummary, summarise } from '../lib/storage'
import { formatRelativeTime } from '../lib/time'
import { withSessionParam } from '../lib/url'
import { useCanvas } from '../store/useCanvas'
import { Badge, Button } from './ui'

/**
 * Saved sessions, as a collapsible left rail.
 *
 * Collapsed it keeps a narrow strip rather than disappearing: a sidebar you
 * cannot see is a sidebar nobody remembers exists, and the canvas is already
 * flanked by a 440px inspector.
 */
export function SessionSidebar() {
  const canvas = useCanvas((s) => s.canvas)
  const open = useCanvas((s) => s.sessionsOpen)
  const setOpen = useCanvas((s) => s.setSessionsOpen)
  const listSessions = useCanvas((s) => s.listSessions)
  const openSession = useCanvas((s) => s.openSession)
  const duplicateSession = useCanvas((s) => s.duplicateSession)
  const deleteSession = useCanvas((s) => s.deleteSession)
  const newCanvas = useCanvas((s) => s.newCanvas)
  const setNotice = useCanvas((s) => s.setNotice)

  const [saved, setSaved] = useState<CanvasSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = () => void listSessions().then(setSaved)

  // Re-read on open and whenever the session changes. Not on every edit: the
  // open canvas is merged in live below, so the list stays current without
  // hitting IndexedDB on each keystroke.
  useEffect(() => {
    if (open) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvas.id])

  /**
   * The open canvas is shown from memory rather than from its last save, so a
   * rename or a new run is reflected immediately instead of one save behind.
   */
  const sessions = useMemo(() => {
    const live = summarise(canvas)
    const rest = (saved ?? []).filter((s) => s.id !== canvas.id)
    return [live, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [saved, canvas])

  const visible = useMemo(() => filterSessions(sessions, query), [sessions, query])

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-[var(--color-edge)] bg-[var(--color-panel)] py-2">
        <button
          onClick={() => setOpen(true)}
          title="Show sessions"
          aria-label="Show sessions"
          className="rounded px-1.5 py-1 text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]"
        >
          »
        </button>
        <span
          className="text-[10px] text-[#5a6175]"
          style={{ writingMode: 'vertical-rl' }}
          title={`${sessions.length} saved ${sessions.length === 1 ? 'session' : 'sessions'}`}
        >
          sessions · {sessions.length}
        </span>
      </div>
    )
  }

  return (
    <aside className="flex w-[284px] shrink-0 flex-col border-r border-[var(--color-edge)] bg-[var(--color-panel)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-edge)] px-2.5 py-2">
        <span className="text-[12px] font-semibold">Sessions</span>
        <span className="text-[11px] text-[#5a6175]">{sessions.length}</span>
        <button
          onClick={() => setOpen(false)}
          title="Hide sessions"
          aria-label="Hide sessions"
          className="ml-auto rounded px-1.5 py-0.5 text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]"
        >
          «
        </button>
      </div>

      <div className="space-y-2 border-b border-[var(--color-edge)] px-2.5 py-2">
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          onClick={() => {
            newCanvas()
            setQuery('')
            setNotice({ kind: 'info', text: 'Started a new session.' })
          }}
        >
          New session
        </Button>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names and prompts…"
            className="w-full rounded border border-[var(--color-edge)] bg-[var(--color-canvas)] py-1.5 pl-2.5 pr-6 text-[12px] text-[var(--color-ink)] placeholder:text-[#5a6175] focus:border-[var(--color-accent)] focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {visible.length === 0 && (
          <p className="px-2 py-8 text-center text-[11px] leading-relaxed text-[#5a6175]">
            {query
              ? `Nothing matches “${query}”.`
              : 'No saved sessions yet. This one appears as soon as you edit it.'}
          </p>
        )}

        {visible.map((s) => {
          const isCurrent = s.id === canvas.id
          return (
            <div
              key={s.id}
              className={`mb-1 rounded-md border px-2.5 py-2 ${
                isCurrent
                  ? 'border-[var(--color-accent)]/50 bg-[#232a4d]/20'
                  : 'border-transparent hover:border-[var(--color-edge)] hover:bg-[var(--color-edge)]/20'
              }`}
            >
              <button
                onClick={() => !isCurrent && void openSession(s.id)}
                disabled={isCurrent}
                className="block w-full text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-medium">{s.name}</span>
                  {isCurrent && <Badge tone="accent">open</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[10.5px] text-[#5a6175]">
                  {formatRelativeTime(s.updatedAt)} · {s.nodeCount}{' '}
                  {s.nodeCount === 1 ? 'node' : 'nodes'}
                  {s.runCount > 0 ? ` · ${s.runCount} gen` : ''}
                </div>
                {query && matchedInBody(s, query) && (
                  <div className="mt-0.5 text-[10px] text-[var(--color-warn)]">
                    matched in prompt text
                  </div>
                )}
              </button>

              {confirming === s.id ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="flex-1 text-[10.5px] leading-snug text-[var(--color-warn)]">
                    Delete this session?
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      setConfirming(null)
                      await deleteSession(s.id)
                      refresh()
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-0.5 text-[10.5px]">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          withSessionParam(window.location.href, s.id),
                        )
                        setCopied(s.id)
                        setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 1500)
                      } catch {
                        setNotice({ kind: 'warn', text: 'The clipboard is not available here.' })
                      }
                    }}
                    title="Copy a link that reopens this session — on this browser only"
                    className="rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]"
                  >
                    {copied === s.id ? 'copied' : 'link'}
                  </button>
                  <button
                    onClick={async () => {
                      await duplicateSession(s.id)
                      refresh()
                    }}
                    className="rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]"
                  >
                    duplicate
                  </button>
                  <button
                    onClick={() => setConfirming(s.id)}
                    className="rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:bg-[#3a1f22] hover:text-[var(--color-danger)]"
                  >
                    delete
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="border-t border-[var(--color-edge)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[#5a6175]">
        Saved in this browser only. Export to keep a copy elsewhere.
      </p>
    </aside>
  )
}
