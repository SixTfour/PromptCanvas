import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../time'

describe('relative timestamps', () => {
  const NOW = new Date('2026-06-15T12:00:00Z').getTime()
  const ago = (ms: number) => NOW - ms
  const SEC = 1000
  const MIN = 60 * SEC
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('collapses anything very recent to "just now"', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now')
    expect(formatRelativeTime(ago(30 * SEC), NOW)).toBe('just now')
  })

  it('reads naturally across minutes, hours and days', () => {
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('an hour ago')
    expect(formatRelativeTime(ago(5 * HOUR), NOW)).toBe('5 hours ago')
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('yesterday')
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3 days ago')
    expect(formatRelativeTime(ago(8 * DAY), NOW)).toBe('last week')
  })

  it('falls back to a date once a count of weeks stops being useful', () => {
    const out = formatRelativeTime(ago(200 * DAY), NOW)
    expect(out).not.toMatch(/ago|just now/)
    expect(out).toMatch(/\d/)
  })

  // A machine whose clock drifts should not report work as done in the future.
  it('does not produce a negative age from clock skew', () => {
    expect(formatRelativeTime(NOW + 5 * MIN, NOW)).toBe('just now')
  })

})
