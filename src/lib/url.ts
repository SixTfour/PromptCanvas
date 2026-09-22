/**
 * Session addressing in the URL.
 *
 * `?session=<id>` makes a canvas bookmarkable and gives browser Back and
 * Forward something sensible to do between sessions.
 *
 * It is an address, not a share link: the id names a record in *this* browser's
 * IndexedDB, so the same URL opened elsewhere finds nothing. The UI says so
 * where it offers to copy one, and a link to a session that is not here is
 * reported rather than silently ignored.
 *
 * Pure string functions, so the parsing and rewriting are testable without a
 * document.
 */

export const SESSION_PARAM = 'session'

/** The session id named by a query string, if any. */
export function sessionIdFromSearch(search: string): string | null {
  try {
    const id = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(
      SESSION_PARAM,
    )
    return id && id.trim() ? id.trim() : null
  } catch {
    return null
  }
}

/**
 * The same URL with the session id set, leaving every other parameter alone —
 * this app has none today, but silently dropping a stranger's parameters is the
 * kind of thing that only shows up later.
 */
export function withSessionParam(href: string, id: string): string {
  try {
    const url = new URL(href)
    url.searchParams.set(SESSION_PARAM, id)
    return url.toString()
  } catch {
    return href
  }
}

/** The same URL with the session id removed. */
export function withoutSessionParam(href: string): string {
  try {
    const url = new URL(href)
    url.searchParams.delete(SESSION_PARAM)
    return url.toString()
  } catch {
    return href
  }
}
