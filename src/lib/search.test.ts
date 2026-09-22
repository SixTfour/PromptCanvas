import { describe, expect, it } from 'vitest'
import { filterSessions, matchedInBody, matchesQuery, orderSessions } from './search'
import type { CanvasSummary } from './storage'

describe('session search', () => {
  const session = (over: Partial<CanvasSummary> = {}): CanvasSummary => ({
    id: 'c1',
    name: 'Bug report triage',
    updatedAt: 0,
    nodeCount: 3,
    runCount: 2,
    haystack: 'bug report triage baseline correction: severity checkout spins on iphone safari',
    ...over,
  })

  it('matches on the session name', () => {
    expect(matchesQuery(session(), 'triage')).toBe(true)
    expect(matchesQuery(session(), 'nonsense')).toBe(false)
  })

  // The main reason to search prompts: most sessions keep whatever name the
  // starter gave them, so the name alone rarely tells them apart.
  it('matches on prompt text the name does not mention', () => {
    expect(matchesQuery(session(), 'iphone')).toBe(true)
    expect(matchedInBody(session(), 'iphone')).toBe(true)
    expect(matchedInBody(session(), 'triage')).toBe(false)
  })

  it('narrows as you type, rather than widening', () => {
    expect(matchesQuery(session(), 'safari')).toBe(true)
    expect(matchesQuery(session(), 'safari severity')).toBe(true)
    expect(matchesQuery(session(), 'safari android')).toBe(false)
  })

  it('ignores case and stray whitespace', () => {
    expect(matchesQuery(session(), '  IPHONE   Safari ')).toBe(true)
  })

  it('treats an empty query as no filter at all', () => {
    const all = [session({ id: 'a' }), session({ id: 'b', haystack: 'something else' })]
    expect(filterSessions(all, '')).toHaveLength(2)
    expect(filterSessions(all, '   ')).toHaveLength(2)
    expect(matchedInBody(session(), '')).toBe(false)
  })

  it('filters a list down to the matches', () => {
    const all = [
      session({ id: 'a', haystack: 'alpha prompt' }),
      session({ id: 'b', haystack: 'beta prompt' }),
    ]
    expect(filterSessions(all, 'alpha').map((s) => s.id)).toEqual(['a'])
    expect(filterSessions(all, 'prompt')).toHaveLength(2)
  })
})

describe('session ordering', () => {
  const s = (id: string, updatedAt: number): CanvasSummary => ({
    id,
    name: id,
    updatedAt,
    nodeCount: 1,
    runCount: 0,
    haystack: id,
  })

  it('pins the open session to the top even when it is the oldest', () => {
    const list = [s('a', 300), s('b', 200), s('open', 100)]
    expect(orderSessions(list, 'open').map((x) => x.id)).toEqual(['open', 'a', 'b'])
  })

  it('orders everything else by when it was last edited or run', () => {
    const list = [s('old', 100), s('new', 300), s('mid', 200)]
    expect(orderSessions(list, null).map((x) => x.id)).toEqual(['new', 'mid', 'old'])
  })

  // Equal timestamps are common right after a bulk operation; without a
  // tie-break the list reshuffles between renders for no visible reason.
  it('is stable when timestamps are equal', () => {
    const list = [s('c', 100), s('a', 100), s('b', 100)]
    const once = orderSessions(list, null).map((x) => x.id)
    const twice = orderSessions([...list].reverse(), null).map((x) => x.id)
    expect(once).toEqual(twice)
  })

  it('does nothing surprising when the open session is not in the list', () => {
    const list = [s('a', 200), s('b', 100)]
    expect(orderSessions(list, 'missing').map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('handles an empty list', () => {
    expect(orderSessions([], 'open')).toEqual([])
  })
})
