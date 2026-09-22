import { describe, expect, it } from 'vitest'
import { type StorageLike, readPref, writePref } from '../prefs'

describe('remembered view preferences', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = { ...initial }
    return {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v
      },
      data,
    }
  }

  it('round-trips a stored value', () => {
    const s = fakeStorage()
    writePref('view', 'rendered', s)
    expect(readPref('view', ['raw', 'rendered'] as const, 'raw', s)).toBe('rendered')
  })

  it('falls back when nothing has been stored', () => {
    expect(readPref('view', ['raw', 'rendered'] as const, 'raw', fakeStorage())).toBe('raw')
  })

  // Stored preferences outlive the code that wrote them. An option that was
  // renamed or dropped must not come back as a state with no UI branch.
  it('rejects a value the code no longer understands', () => {
    const s = fakeStorage({ view: 'some-old-mode' })
    expect(readPref('view', ['raw', 'rendered'] as const, 'raw', s)).toBe('raw')
  })

  it('survives storage being unavailable entirely', () => {
    expect(readPref('view', ['raw'] as const, 'raw', null)).toBe('raw')
    expect(() => writePref('view', 'raw', null)).not.toThrow()
  })

  it('survives storage that throws, as it does in a private window', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readPref('view', ['raw', 'rendered'] as const, 'raw', hostile)).toBe('raw')
    expect(() => writePref('view', 'rendered', hostile)).not.toThrow()
  })
})
