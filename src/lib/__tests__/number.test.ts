import { describe, expect, it } from 'vitest'
import { commitNumber, presetsWithin } from '../number'

describe('committing a typed number', () => {
  const MIN = 16
  const MAX = 2048
  const CURRENT = 256

  // The bug this replaces: clamping per keystroke meant typing "512" produced
  // 5, which snapped to 16, and every later digit landed after it.
  it('accepts a value whose first digits are below the minimum', () => {
    expect(commitNumber('512', CURRENT, MIN, MAX)).toBe(512)
  })

  it('clamps only a finished value', () => {
    expect(commitNumber('5', CURRENT, MIN, MAX)).toBe(16)
    expect(commitNumber('99999', CURRENT, MIN, MAX)).toBe(2048)
  })

  // Clearing a field is the start of retyping, not a request for a default.
  it('reverts rather than inventing a value when there is nothing to commit', () => {
    expect(commitNumber('', CURRENT, MIN, MAX)).toBe(CURRENT)
    expect(commitNumber('   ', CURRENT, MIN, MAX)).toBe(CURRENT)
    expect(commitNumber('abc', CURRENT, MIN, MAX)).toBe(CURRENT)
    expect(commitNumber('-', CURRENT, MIN, MAX)).toBe(CURRENT)
  })

  it('tolerates whitespace and decimals', () => {
    expect(commitNumber('  384  ', CURRENT, MIN, MAX)).toBe(384)
    expect(commitNumber('384.7', CURRENT, MIN, MAX)).toBe(385)
  })

  it('never returns a value outside the range', () => {
    for (const input of ['0', '-500', '1', '2047', '2048', '2049', '1e9']) {
      const out = commitNumber(input, CURRENT, MIN, MAX)
      expect(out, input).toBeGreaterThanOrEqual(MIN)
      expect(out, input).toBeLessThanOrEqual(MAX)
    }
  })

  it('offers only presets the model can actually hold', () => {
    expect(presetsWithin([128, 256, 512, 1024, 2048], 16, 2048)).toEqual([
      128, 256, 512, 1024, 2048,
    ])
    // A 2048-token model should not be offered 4096 as a one-click choice.
    expect(presetsWithin([128, 256, 4096], 16, 2048)).toEqual([128, 256])
  })
})
