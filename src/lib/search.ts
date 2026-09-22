import type { CanvasSummary } from './storage'

/**
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
