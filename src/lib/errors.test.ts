import { describe, expect, it } from 'vitest'
import { friendlyError } from './errors'

describe('error messages for local inference', () => {
  it('names the out-of-memory case and suggests a smaller model', () => {
    const f = friendlyError(new Error('Failed to allocate buffer: out of memory'))
    expect(f.message).toMatch(/out of memory/i)
    expect(f.hint).toMatch(/smaller model|close other tabs/i)
  })

  it('explains a WebGPU failure as a fallback rather than a dead end', () => {
    const f = friendlyError(new Error('Device lost: webgpu adapter unavailable'))
    expect(f.message).toMatch(/webgpu/i)
    expect(f.hint).toMatch(/CPU/i)
  })

  it('tells the user weights are cached after the first download', () => {
    const f = friendlyError(new TypeError('Failed to fetch'))
    expect(f.message).toMatch(/could not be downloaded/i)
    expect(f.hint).toMatch(/cached|offline/i)
  })

  it('treats an interrupt as a cancellation, not a failure', () => {
    expect(friendlyError(new Error('Generation was interrupted')).message).toBe('Cancelled.')
  })

  it('translates a bad import file', () => {
    let thrown: unknown
    try {
      JSON.parse('not json')
    } catch (e) {
      thrown = e
    }
    expect(friendlyError(thrown).message).toBe('That file is not valid JSON.')
  })

  it('does not render "undefined" or "[object Object]" for odd throws', () => {
    for (const odd of [undefined, null, {}, 42, '']) {
      expect(friendlyError(odd).message).not.toMatch(/undefined|\[object Object\]|^$/)
    }
  })

})
