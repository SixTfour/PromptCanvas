import { describe, expect, it } from 'vitest'
import { backendAdvice } from './backend'

describe('backend advice', () => {
  it('says nothing when the GPU is already in use', () => {
    expect(backendAdvice({ state: 'gpu', f16: true })).toBeNull()
    expect(backendAdvice({ state: 'gpu', f16: false })).toBeNull()
  })

  it('names the exact setting when acceleration is switched off', () => {
    const a = backendAdvice({ state: 'no-adapter', f16: false })
    expect(a?.tone).toBe('warn')
    // The whole point is actionability: a warning without the path is noise.
    expect(a?.action).toContain('chrome://settings/system')
    expect(a?.action).toContain('graphics acceleration')
    expect(a?.action).toContain('chrome://gpu')
  })

  it('distinguishes an unsupported browser from a disabled setting', () => {
    const off = backendAdvice({ state: 'no-adapter', f16: false })
    const none = backendAdvice({ state: 'unsupported', f16: false })
    expect(none?.title).not.toBe(off?.title)
    // Nothing to toggle here, so offering a settings path would be misleading.
    expect(none?.action).toBeUndefined()
  })

})
