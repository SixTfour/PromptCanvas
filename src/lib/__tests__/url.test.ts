import { describe, expect, it } from 'vitest'
import { sessionIdFromSearch, withSessionParam } from '../url'

describe('session URLs', () => {
  const BASE = 'https://promptcanvas.example/app'

  it('reads the session id from a query string, with or without the "?"', () => {
    expect(sessionIdFromSearch('?session=c-abc123')).toBe('c-abc123')
    expect(sessionIdFromSearch('session=c-abc123')).toBe('c-abc123')
  })

  it('returns null when there is nothing to read', () => {
    expect(sessionIdFromSearch('')).toBeNull()
    expect(sessionIdFromSearch('?other=1')).toBeNull()
    expect(sessionIdFromSearch('?session=')).toBeNull()
    expect(sessionIdFromSearch('?session=%20%20')).toBeNull()
  })

  it('round-trips an id through the URL', () => {
    const href = withSessionParam(BASE, 'c-xyz789')
    expect(sessionIdFromSearch(new URL(href).search)).toBe('c-xyz789')
  })

  it('replaces an existing session rather than appending a second one', () => {
    const once = withSessionParam(BASE, 'c-one')
    const twice = withSessionParam(once, 'c-two')
    expect(sessionIdFromSearch(new URL(twice).search)).toBe('c-two')
    expect(twice.match(/session=/g)).toHaveLength(1)
  })

  // Nothing else uses query params today, which is exactly when this kind of
  // thing gets broken without anyone noticing.
  it('leaves other query parameters alone', () => {
    const href = withSessionParam(`${BASE}?keep=yes&also=1`, 'c-abc')
    const params = new URL(href).searchParams
    expect(params.get('keep')).toBe('yes')
    expect(params.get('also')).toBe('1')
    expect(params.get('session')).toBe('c-abc')
  })

  it('hands back the input unchanged rather than throwing on a bad URL', () => {
    expect(withSessionParam('not a url', 'c-abc')).toBe('not a url')
  })
})
