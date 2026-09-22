import { describe, expect, it } from 'vitest'
import { friendlyError } from '../errors'

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

describe('a load that failed on every weight variant', () => {
  const composite =
    'No usable weight variant for HuggingFaceTB/SmolLM-135M-Instruct on webgpu. ' +
    'Tried q4f16: Failed to fetch; fp32: Failed to fetch.'

  /*
   * The summary names the device it was attempting, which a generic match on
   * "webgpu" claimed first — reporting an automatic CPU fallback that never
   * happened, and discarding the per-variant reasons entirely.
   */
  it('does not mistake a total failure for a graceful CPU fallback', () => {
    const f = friendlyError(new Error(composite))
    expect(f.message).not.toMatch(/falls back|unavailable or the graphics/i)
    expect(f.hint ?? '').not.toMatch(/slower but works/i)
  })

  it('surfaces the underlying reason instead of swallowing it', () => {
    const f = friendlyError(new Error(composite))
    expect(f.hint ?? '').toContain('Failed to fetch')
  })

  it('classifies by the underlying reason, not the wrapper', () => {
    const oom = friendlyError(
      new Error('No usable weight variant for m on webgpu. Tried q4f16: out of memory.'),
    )
    expect(oom.hint ?? '').toMatch(/smaller model|close other tabs/i)
  })

  it('still reports a genuine WebGPU failure as one', () => {
    expect(friendlyError(new Error('Device lost')).message).toMatch(/WebGPU/i)
  })
})

describe('deployment-only failures', () => {
  // A dev server guesses the type of a .wasm; a CDN states it, and with
  // nosniff a wrong statement is fatal rather than merely wrong.
  it('names the content type when the runtime is served wrongly', () => {
    const f = friendlyError(
      new TypeError("Incorrect response MIME type. Expected 'application/wasm'."),
    )
    expect(f.message).toMatch(/content type/i)
    expect(f.hint ?? '').toMatch(/application\/wasm/i)
  })

  it('distinguishes a blocked request from an offline one', () => {
    const blocked = friendlyError(
      new Error("Refused to connect to 'https://us.aws.cdn.hf.co/...' because of Content Security Policy"),
    )
    expect(blocked.message).toMatch(/blocked/i)
    expect(blocked.hint ?? '').toMatch(/Content Security Policy/i)
  })
})
