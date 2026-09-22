import type { CanvasSummary } from './storage'

/**
 * Session list: searching and ordering.
 *
 * Session search.
 *
 * Matches the session name *and* the prompt text inside it, because you are far
 * more likely to remember what a canvas was about than what you called it —
 * most sessions end up named after whatever the starter was called.
 *
 * Terms are ANDed: every word has to appear somewhere. That makes a longer
 * query narrow the list, which is what typing more is for.
 */
export function matchesQuery(summary: CanvasSummary, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  return terms.every((t) => summary.haystack.includes(t))
}

/** Whether the name alone accounts for the match, or the body did the work. */
export function matchedInBody(summary: CanvasSummary, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return false
  const name = summary.name.toLowerCase()
  return !terms.every((t) => name.includes(t))
}

export function filterSessions(sessions: CanvasSummary[], query: string): CanvasSummary[] {
  if (!query.trim()) return sessions
  return sessions.filter((s) => matchesQuery(s, query))
}

/**
 * The order the session list is shown in.
 *
 * The open session is pinned to the top rather than competing on recency: it is
 * the one you are looking at, and having it slide down the list the moment you
 * open something older is disorienting. Everything else is ordered by when it
 * was last edited or run, with the id as a tie-break so equal timestamps do not
 * shuffle between renders.
 */
export function orderSessions(
  sessions: CanvasSummary[],
  currentId: string | null,
): CanvasSummary[] {
  const current = sessions.filter((s) => s.id === currentId)
  const rest = sessions
    .filter((s) => s.id !== currentId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  return [...current, ...rest]
}
