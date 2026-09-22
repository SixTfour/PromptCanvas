/**
 * Relative timestamps for the session list.
 *
 * A session list is read to answer "which one was I in?", and an absolute
 * timestamp makes you do the arithmetic yourself. Pure, and takes `now` as an
 * argument, so the boundaries are testable without freezing the clock.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const seconds = Math.round((now - ts) / 1000)

  if (seconds < 0) return 'just now' // clock skew is not worth a special case
  if (seconds < 45) return 'just now'
  if (seconds < 90) return 'a minute ago'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minutes ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`

  const days = Math.round(hours / 24)
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`
  if (days < 31) {
    const weeks = Math.round(days / 7)
    return weeks === 1 ? 'last week' : `${weeks} weeks ago`
  }

  // Past a month, a date is more use than a count of weeks.
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: new Date(ts).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  })
}
