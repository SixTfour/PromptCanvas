import { describe, expect, it } from 'vitest'
import { starter } from '../../test/fixtures'
import { composePrompt } from '../compose'
import {
  DEFAULT_MODEL,
  HALF_PRECISION,
  MODELS,
  MODEL_IDS,
  contextPressure,
  dtypeCandidates,
  effectiveMaxNewTokens,
  estimateTokens,
  modelIdFromUrl,
  type Dtype,
} from '../models'

describe('local model registry', () => {
  it('defaults to the smallest model, so the first download is the cheapest', () => {
    const smallest = MODEL_IDS.reduce((a, b) =>
      MODELS[a].downloadMb <= MODELS[b].downloadMb ? a : b,
    )
    expect(DEFAULT_MODEL).toBe(smallest)
  })

})

describe('context budget', () => {
  // Named explicitly rather than via DEFAULT_MODEL: the subject here is how a
  // 2048-token window behaves, not which model happens to be the default.
  const TIGHT_WINDOW = 'HuggingFaceTB/SmolLM-135M-Instruct' as const

  it('counts generated tokens against the same window as the prompt', () => {
    const p = contextPressure(TIGHT_WINDOW, 1900, 256)
    expect(p.limit).toBe(2048)
    expect(p.used).toBe(2156)
    expect(p.level).toBe('over')
  })

  it('warns before overflowing rather than only after', () => {
    expect(contextPressure(TIGHT_WINDOW, 1500, 256).level).toBe('tight')
    expect(contextPressure(TIGHT_WINDOW, 400, 256).level).toBe('ok')
  })

  it('fits every starter branch on the default model', () => {
    // Every node the starter actually ships, so a node that quietly stopped
    // existing cannot make this pass by having nothing to check.
    const ids = starter.nodes.map((n) => n.id)
    expect(ids).toHaveLength(3)
    for (const id of ids) {
      const c = composePrompt(starter, id)
      const tokens = estimateTokens(c.text) + estimateTokens(c.system)
      const p = contextPressure(DEFAULT_MODEL, tokens, 256)
      expect(p.level, `${id} overflows the default model's window`).not.toBe('over')
    }
  })
})

describe('cached weight attribution', () => {
  const HF = 'https://huggingface.co'

  it('attributes a weight URL to the right model', () => {
    expect(modelIdFromUrl(`${HF}/HuggingFaceTB/SmolLM-135M-Instruct/resolve/main/onnx/model_fp16.onnx`)).toBe(
      'HuggingFaceTB/SmolLM-135M-Instruct',
    )
    expect(modelIdFromUrl(`${HF}/HuggingFaceTB/SmolLM2-1.7B-Instruct/resolve/main/tokenizer.json`)).toBe(
      'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    )
  })

  it('attributes nothing it is not sure about', () => {
    // A sibling repo whose name merely starts with a known id must not be
    // attributed to it, or deleting one would take the other's files.
    const decoy = `${HF}/HuggingFaceTB/SmolLM-135M-Instruct-GGUF/resolve/main/model.gguf`
    expect(modelIdFromUrl(decoy)).toBeNull()
    expect(modelIdFromUrl('https://example.com/whatever.bin')).toBeNull()
    expect(modelIdFromUrl('')).toBeNull()
  })

})

describe('weight variant selection', () => {
  const GPU = 'webgpu' as const
  const CPU = 'wasm' as const

  it('never offers the CPU backend a half-precision variant', () => {
    for (const id of MODEL_IDS) {
      for (const f16 of [true, false]) {
        for (const d of dtypeCandidates(id, CPU, f16)) {
          expect(HALF_PRECISION, `${id} on cpu`).not.toContain(d)
        }
      }
    }
  })

  it('drops half-precision candidates when the adapter lacks shader-f16', () => {
    for (const id of MODEL_IDS) {
      for (const d of dtypeCandidates(id, GPU, false)) {
        expect(HALF_PRECISION, `${id} without shader-f16`).not.toContain(d)
      }
    }
  })

  // The bug this guards: an adapter can advertise shader-f16, load fp16 weights,
  // and still generate nothing. A single choice left no way out of that.
  it('always leaves a fallback to try after the first candidate', () => {
    for (const id of MODEL_IDS) {
      expect(dtypeCandidates(id, GPU, true).length, `${id} on gpu`).toBeGreaterThan(1)
      expect(dtypeCandidates(id, CPU, false).length, `${id} on cpu`).toBeGreaterThan(1)
    }
  })

  it('never returns an empty list, whatever the machine reports', () => {
    for (const id of MODEL_IDS) {
      for (const backend of [GPU, CPU]) {
        for (const f16 of [true, false]) {
          expect(dtypeCandidates(id, backend, f16).length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('puts a previously verified variant first, without duplicating it', () => {
    const id = MODEL_IDS[0]
    const all = dtypeCandidates(id, GPU, true)
    const fallback = all[1]
    const reordered = dtypeCandidates(id, GPU, true, fallback)
    expect(reordered[0]).toBe(fallback)
    expect(reordered).toHaveLength(all.length)
    expect(new Set(reordered).size).toBe(reordered.length)
  })

  it('ignores a remembered variant that is not valid for this backend', () => {
    const id = MODEL_IDS[0]
    // fp16 was verified on some other machine; this one has no shader-f16.
    const candidates = dtypeCandidates(id, GPU, false, 'fp16' as Dtype)
    expect(candidates).not.toContain('fp16')
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('keeps the 1.7B off variants with multi-GB external weight files', () => {
    const big = 'HuggingFaceTB/SmolLM2-1.7B-Instruct' as const
    for (const backend of [GPU, CPU]) {
      for (const f16 of [true, false]) {
        const c = dtypeCandidates(big, backend, f16)
        expect(c).not.toContain('fp32')
        expect(c).not.toContain('fp16')
      }
    }
  })
})

describe('auto response length', () => {
  const TINY = 'HuggingFaceTB/SmolLM-135M-Instruct' as const // 2048 context
  const BIG = 'HuggingFaceTB/SmolLM2-360M-Instruct' as const // 8192 context

  it('uses whatever the prompt leaves free', () => {
    const out = effectiveMaxNewTokens(TINY, 500, 'auto')
    expect(out).toBeGreaterThan(1400)
    expect(out + 500).toBeLessThanOrEqual(2048)
  })

  it('shrinks as the prompt grows, which is the point of auto', () => {
    const shallow = effectiveMaxNewTokens(BIG, 200, 'auto')
    const deep = effectiveMaxNewTokens(BIG, 4000, 'auto')
    expect(deep).toBeLessThan(shallow)
  })

  // A branch deep enough to fill the window must not resolve to zero or a
  // negative limit; contextPressure reports that case, the resolver does not
  // silently produce a model that cannot speak.
  it('never resolves below the minimum, even on an overfull prompt', () => {
    expect(effectiveMaxNewTokens(TINY, 5000, 'auto')).toBe(16)
    expect(effectiveMaxNewTokens(TINY, 2048, 'auto', 32)).toBe(32)
  })

  it('honours an explicit cap when there is room for it', () => {
    expect(effectiveMaxNewTokens(BIG, 100, 512)).toBe(512)
  })

  /*
   * An explicit number is a cap, not a demand. A length chosen on a shallow
   * branch must not start truncating the prompt three corrections later, so it
   * is lowered to fit rather than overflowing the window.
   */
  it('lowers an explicit cap to fit alongside a long prompt', () => {
    const capped = effectiveMaxNewTokens(TINY, 1800, 2000)
    expect(capped).toBeLessThan(2000)
    expect(capped + 1800).toBeLessThanOrEqual(2048)
  })

  it('never exceeds the window for any combination', () => {
    for (const prompt of [0, 100, 1000, 2047, 5000]) {
      for (const setting of ['auto' as const, 16, 512, 2048, 99999]) {
        const out = effectiveMaxNewTokens(TINY, prompt, setting)
        expect(out, `${prompt}/${setting}`).toBeGreaterThanOrEqual(16)
        // Either it fits, or the prompt alone already filled the window.
        expect(out + prompt <= 2048 || prompt >= 2048 - 16, `${prompt}/${setting}`).toBe(true)
      }
    }
  })
})

describe('every model is presentable on a node', () => {
  it('has a short label, distinct from the others, that fits beside the title', () => {
    const shorts = Object.values(MODELS).map((m) => m.short)
    for (const short of shorts) {
      expect(short).toBeTruthy()
      // The canvas node is 320px wide and the title needs most of it.
      expect(short.length).toBeLessThanOrEqual(5)
    }
    // A chip that reads the same on every node says nothing.
    expect(new Set(shorts).size).toBe(shorts.length)
  })
})
