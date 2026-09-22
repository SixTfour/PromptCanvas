import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from '../models'
import { migrateCanvas, shortSessionId } from '../storage'

describe('session id display', () => {
  it('leaves a normally generated id alone', () => {
    expect(shortSessionId('c-Ab3dEf9x')).toBe('c-Ab3dEf9x')
  })

  it('truncates an over-long id from an imported canvas', () => {
    const long = 'canvas-from-somewhere-else-0123456789'
    const out = shortSessionId(long)
    expect(out.length).toBeLessThanOrEqual(14)
    expect(out).toContain('…')
  })

  // Two ids that share a prefix are exactly the case this has to survive, so
  // the tail has to be kept rather than trimmed away.
  it('keeps both ends, so ids sharing a prefix stay distinguishable', () => {
    const a = shortSessionId('session-prefix-aaaaaaaa')
    const b = shortSessionId('session-prefix-bbbbbbbb')
    expect(a).not.toBe(b)
  })

  it('handles empty and boundary lengths without throwing', () => {
    expect(shortSessionId('')).toBe('')
    expect(shortSessionId('12345678901234')).toBe('12345678901234')
    expect(shortSessionId('123456789012345').length).toBeLessThanOrEqual(14)
  })
})

describe('migrating older canvases', () => {
  const nodeWith = (maxNewTokens: unknown) => ({
    id: 'n1',
    type: 'prompt' as const,
    position: { x: 0, y: 0 },
    data: {
      title: 'n',
      blocks: [],
      model: DEFAULT_MODEL,
      maxNewTokens,
      runs: [],
    },
  })
  const canvasWith = (maxNewTokens: unknown) =>
    ({
      id: 'c',
      name: 'c',
      rootId: 'n1',
      createdAt: 0,
      updatedAt: 0,
      nodes: [nodeWith(maxNewTokens)],
      edges: [],
    }) as unknown as Parameters<typeof migrateCanvas>[0]

  // 256 was the hardcoded default before length was derived from the prompt,
  // so nobody chose it and old sessions should behave like new ones.
  it('turns the old default into auto', () => {
    expect(migrateCanvas(canvasWith(256)).nodes[0].data.maxNewTokens).toBe('auto')
  })

  it('leaves a deliberately chosen number alone', () => {
    expect(migrateCanvas(canvasWith(512)).nodes[0].data.maxNewTokens).toBe(512)
    expect(migrateCanvas(canvasWith(128)).nodes[0].data.maxNewTokens).toBe(128)
  })

  it('leaves an already-migrated canvas untouched', () => {
    const c = canvasWith('auto')
    expect(migrateCanvas(c)).toBe(c)
  })
})
