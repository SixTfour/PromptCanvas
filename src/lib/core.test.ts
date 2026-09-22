import { describe, expect, it } from 'vitest'
import { buildStarterCanvas } from '../data/starterCanvas'
import type { Run } from '../types'
import { backendAdvice } from './backend'
import { ancestorChain, composePrompt, descendantsOf, parentsOf } from './compose'
import {
  alignPhrases,
  alignRows,
  assemble,
  countChanges,
  segmentPhrases,
  similarity,
} from './diff'
import { formatError, friendlyError } from './errors'
import {
  type KeyLike,
  isRedo,
  isTypingTarget,
  isUndo,
  shortcutLabels,
} from './keys'
import { layoutCanvas } from './layout'
import { clamp, commitNumber, presetsWithin } from './number'
import { type StorageLike, readPref, writePref } from './prefs'
import { isRunOpen, orderRunsNewestFirst, runPreview } from './runs'
import { filterSessions, matchedInBody, matchesQuery, orderSessions } from './search'
import { type CanvasSummary, migrateCanvas, shortSessionId } from './storage'
import { sessionIdFromSearch, withSessionParam, withoutSessionParam } from './url'
import { formatRelativeTime } from './time'
import {
  insertLink,
  textStats,
  toggleLinePrefix,
  toggleOrderedList,
  toggleWrap,
} from './markdown'
import {
  DEFAULT_MODEL,
  MODELS,
  MODEL_IDS,
  contextPressure,
  effectiveMaxNewTokens,
  estimateTokens,
  modelMaxNewTokens,
  HALF_PRECISION,
  dtypeCandidates,
  modelIdFromUrl,
  type Dtype,
} from './models'

const starter = buildStarterCanvas()

/**
 * The starter canvas ships two sibling branches and no merge — merging is
 * something the user does. DAG behaviour still needs covering, so the tests
 * build the merge node the way the store would.
 */
const withMerge = {
  ...starter,
  nodes: [
    ...starter.nodes,
    {
      id: 'n-merged',
      type: 'merge' as const,
      position: { x: 0, y: 0 },
      data: {
        title: 'Merged',
        mergedFrom: ['n-terse', 'n-severity'] as [string, string],
        blocks: [
          { id: 'b-m', label: 'merged', kind: 'correction' as const, enabled: true, text: 'Do both.' },
        ],
        model: DEFAULT_MODEL,
        maxNewTokens: 256,
        runs: [],
      },
    },
  ],
  edges: [
    ...starter.edges,
    { id: 'e-tm', source: 'n-terse', target: 'n-merged', kind: 'merge' as const },
    { id: 'e-sm', source: 'n-severity', target: 'n-merged', kind: 'merge' as const },
  ],
}

describe('DAG traversal', () => {
  it('walks a plain branch root-first', () => {
    expect(ancestorChain(starter, 'n-terse')).toEqual(['n-root', 'n-terse'])
  })

  it('reaches a merge node through both parents without duplicating the root', () => {
    const chain = ancestorChain(withMerge, 'n-merged')
    expect(chain).toContain('n-root')
    expect(chain).toContain('n-terse')
    expect(chain).toContain('n-severity')
    // The shared ancestor must appear exactly once, or its context is sent twice.
    expect(chain.filter((id) => id === 'n-root')).toHaveLength(1)
    // Every node must come after all of its own ancestors.
    expect(chain.indexOf('n-root')).toBeLessThan(chain.indexOf('n-terse'))
    expect(chain.indexOf('n-terse')).toBeLessThan(chain.indexOf('n-merged'))
  })

  it('reports both parents of a merge node', () => {
    expect(parentsOf(withMerge, 'n-merged').sort()).toEqual(['n-severity', 'n-terse'])
  })

  it('finds descendants across the merge join', () => {
    expect(descendantsOf(withMerge, 'n-root')).toEqual(
      new Set(['n-terse', 'n-severity', 'n-merged']),
    )
  })

  it('does not hang on a cycle', () => {
    const cyclic = {
      ...withMerge,
      edges: [
        ...withMerge.edges,
        { id: 'bad', source: 'n-merged', target: 'n-root', kind: 'branch' as const },
      ],
    }
    expect(() => ancestorChain(cyclic, 'n-merged')).not.toThrow()
  })
})

describe('prompt composition', () => {
  it('inherits the root system prompt and instruction down a branch', () => {
    const c = composePrompt(starter, 'n-terse')
    expect(c.system).toContain('engineering triage assistant')
    expect(c.instruction).toBe('Turn the bug report into a triaged engineering ticket.')
  })

  it('marks inherited blocks and includes the branch own block last', () => {
    const c = composePrompt(starter, 'n-terse')
    expect(c.blocks[0].inherited).toBe(true)
    expect(c.blocks.at(-1)?.inherited).toBe(false)
    expect(c.blocks.at(-1)?.kind).toBe('correction')
  })

  it('puts the cache breakpoint at the end of the shared prefix', () => {
    const c = composePrompt(starter, 'n-terse')
    // One inherited block (the bug report) is shared with the sibling branch.
    expect(c.sharedPrefixLength).toBe(1)
    expect(c.blocks.slice(0, c.sharedPrefixLength).every((b) => b.inherited)).toBe(true)
  })

  it('gives two siblings an identical shared prefix', () => {
    const a = composePrompt(starter, 'n-terse')
    const b = composePrompt(starter, 'n-severity')
    const prefixA = a.blocks.slice(0, a.sharedPrefixLength).map((x) => x.text)
    const prefixB = b.blocks.slice(0, b.sharedPrefixLength).map((x) => x.text)
    expect(prefixA).toEqual(prefixB)
  })

  it('excludes disabled blocks from the composed text', () => {
    const off = {
      ...starter,
      nodes: starter.nodes.map((n) =>
        n.id === 'n-root'
          ? { ...n, data: { ...n.data, blocks: n.data.blocks.map((b) => ({ ...b, enabled: false })) } }
          : n,
      ),
    }
    expect(composePrompt(off, 'n-terse').text).not.toContain('NW-88213')
  })
})

describe('phrase diff and merge', () => {
  it('keeps list items whole rather than splitting them mid-bullet', () => {
    const segs = segmentPhrases('- first item. still the item\n- second item')
    expect(segs).toEqual(['- first item. still the item', '- second item'])
  })

  it('splits flowing prose on sentence boundaries', () => {
    expect(segmentPhrases('One thing. Two things! Three?')).toEqual([
      'One thing.',
      'Two things!',
      'Three?',
    ])
  })

  it('marks shared phrases as "both" and unique ones by side', () => {
    const p = alignPhrases('Keep this. Only in A.', 'Keep this. Only in B.')
    const both = p.filter((x) => x.side === 'both')
    expect(both).toHaveLength(1)
    expect(both[0].text).toBe('Keep this.')
    expect(p.some((x) => x.side === 'a' && x.text === 'Only in A.')).toBe(true)
    expect(p.some((x) => x.side === 'b' && x.text === 'Only in B.')).toBe(true)
  })

  it('assembles only the selected phrases, in order', () => {
    const p = alignPhrases('Alpha. Beta.', 'Alpha. Gamma.')
    const picked = new Set(p.filter((x) => x.side !== 'a').map((x) => x.id))
    expect(assemble(p, picked)).toBe('Alpha.\nGamma.')
  })

  it('scores identical text as fully similar and disjoint text as not', () => {
    expect(similarity('Same words here.', 'Same words here.')).toBe(1)
    expect(similarity('Totally different.', 'Nothing alike.')).toBeLessThan(0.2)
  })
})


describe('layout', () => {
  it('lays out a DAG with a two-parent merge without losing nodes', () => {
    const out = layoutCanvas(withMerge)
    expect(out.nodes).toHaveLength(withMerge.nodes.length)
    // The merge must sit to the right of both of its parents.
    const pos = Object.fromEntries(out.nodes.map((n) => [n.id, n.position]))
    expect(pos['n-merged'].x).toBeGreaterThan(pos['n-terse'].x)
    expect(pos['n-merged'].x).toBeGreaterThan(pos['n-severity'].x)
  })

  it('tolerates an edge pointing at a deleted node', () => {
    const broken = {
      ...starter,
      edges: [
        ...starter.edges,
        { id: 'x', source: 'n-root', target: 'gone', kind: 'branch' as const },
      ],
    }
    expect(() => layoutCanvas(broken)).not.toThrow()
  })
})


describe('local model registry', () => {
  it('orders the size markers from smallest to largest model', () => {
    const byDownload = MODEL_IDS.slice().sort((a, b) => MODELS[a].downloadMb - MODELS[b].downloadMb)
    expect(MODELS[byDownload[0]].size).toBe('◆')
    expect(MODELS[byDownload.at(-1)!].size).toBe('◆◆◆')
  })

  it('defaults to the smallest model, so the first download is the cheapest', () => {
    const smallest = MODEL_IDS.reduce((a, b) =>
      MODELS[a].downloadMb <= MODELS[b].downloadMb ? a : b,
    )
    expect(DEFAULT_MODEL).toBe(smallest)
  })

  it('gives every model a caveat, since none of them are strong', () => {
    for (const id of MODEL_IDS) expect(MODELS[id].caveat.length).toBeGreaterThan(40)
  })
})

describe('context budget', () => {
  // The binding constraint is no longer money, it is the 2048-token window on
  // SmolLM 135M, which the prompt and the completion share.
  it('counts generated tokens against the same window as the prompt', () => {
    const p = contextPressure(DEFAULT_MODEL, 1900, 256)
    expect(p.limit).toBe(2048)
    expect(p.used).toBe(2156)
    expect(p.level).toBe('over')
  })

  it('warns before overflowing rather than only after', () => {
    expect(contextPressure(DEFAULT_MODEL, 1500, 256).level).toBe('tight')
    expect(contextPressure(DEFAULT_MODEL, 400, 256).level).toBe('ok')
  })

  it('flags the bundled sample branches as safe on the default model', () => {
    for (const id of ['n-root', 'n-terse', 'n-severity', 'n-merged']) {
      const c = composePrompt(starter, id)
      const tokens = estimateTokens(c.text) + estimateTokens(c.system)
      const p = contextPressure(DEFAULT_MODEL, tokens, 256)
      expect(p.level, `${id} overflows the default model's window`).not.toBe('over')
    }
  })
})

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

  it('flattens message and hint into readable lines', () => {
    const out = formatError(new Error('out of memory'))
    expect(out.split('\n\n')).toHaveLength(2)
  })
})

describe('side-by-side diff rows', () => {
  it('pairs a reworded phrase into one row instead of a delete plus an insert', () => {
    const rows = alignRows('Be concise and clear.', 'Be terse and clear.')
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('changed')
    expect(rows[0].a).toBe('Be concise and clear.')
    expect(rows[0].b).toBe('Be terse and clear.')
  })

  it('shows each column only its own side markers', () => {
    const [row] = alignRows('Be concise.', 'Be terse.')
    // The A column must never render B's insertions, or it stops reading as prose.
    expect(row.aChunks?.some((c) => c.kind === 'added')).toBe(false)
    expect(row.bChunks?.some((c) => c.kind === 'removed')).toBe(false)
    expect(row.aChunks?.map((c) => c.value).join('')).toBe('Be concise.')
    expect(row.bChunks?.map((c) => c.value).join('')).toBe('Be terse.')
  })

  it('puts a pure addition on the B side only, with no A counterpart', () => {
    const rows = alignRows('Shared line.', `Shared line.
Brand new.`)
    expect(rows.map((r) => r.kind)).toEqual(['same', 'added'])
    expect(rows[1].a).toBeUndefined()
    expect(rows[1].b).toBe('Brand new.')
  })

  it('puts a pure removal on the A side only, with no B counterpart', () => {
    const rows = alignRows(`Shared line.
Going away.`, 'Shared line.')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'removed'])
    expect(rows[1].b).toBeUndefined()
    expect(rows[1].a).toBe('Going away.')
  })

  it('handles an uneven rewrite without dropping or duplicating phrases', () => {
    const aText = 'One. Two. Three.'
    const bText = 'One changed. Two changed. Three changed. Four added.'
    const rows = alignRows(aText, bText)
    expect(rows.flatMap((r) => (r.a ? [r.a] : []))).toEqual(segmentPhrases(aText))
    expect(rows.flatMap((r) => (r.b ? [r.b] : []))).toEqual(segmentPhrases(bText))
  })

  it('never loses a phrase, whatever the shape of the edit', () => {
    const cases: Array<[string, string]> = [
      ['', 'Only B.'],
      ['Only A.', ''],
      ['Same.', 'Same.'],
      ['A one. A two. A three.', 'B one.'],
      ['A one.', 'B one. B two. B three.'],
      ['Keep. Drop. Keep two.', 'Keep. Keep two.'],
    ]
    for (const [x, y] of cases) {
      const rows = alignRows(x, y)
      expect(rows.flatMap((r) => (r.a ? [r.a] : [])), `A side of ${JSON.stringify(x)}`).toEqual(
        segmentPhrases(x),
      )
      expect(rows.flatMap((r) => (r.b ? [r.b] : [])), `B side of ${JSON.stringify(y)}`).toEqual(
        segmentPhrases(y),
      )
    }
  })

  it('reports identical text as zero differences', () => {
    expect(countChanges(alignRows('Same words.', 'Same words.'))).toBe(0)
    expect(countChanges(alignRows('One.', 'Two.'))).toBe(1)
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

  it('does not confuse SmolLM with SmolLM2', () => {
    const url = `${HF}/HuggingFaceTB/SmolLM2-360M-Instruct/resolve/main/config.json`
    expect(modelIdFromUrl(url)).toBe('HuggingFaceTB/SmolLM2-360M-Instruct')
    expect(modelIdFromUrl(url)).not.toBe('HuggingFaceTB/SmolLM-135M-Instruct')
  })

  it('requires a bounded path segment, not a bare substring', () => {
    // A hypothetical sibling repo whose name merely starts with a known id must
    // not be attributed to that id, or deleting one would take the other's files.
    const decoy = `${HF}/HuggingFaceTB/SmolLM-135M-Instruct-GGUF/resolve/main/model.gguf`
    expect(modelIdFromUrl(decoy)).toBeNull()
  })

  it('ignores unrelated URLs', () => {
    expect(modelIdFromUrl('https://example.com/whatever.bin')).toBeNull()
    expect(modelIdFromUrl('')).toBeNull()
  })

  it('claims every model it is asked about, so nothing is orphaned', () => {
    for (const id of MODEL_IDS) {
      expect(modelIdFromUrl(`${HF}/${id}/resolve/main/onnx/model.onnx`)).toBe(id)
    }
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

  it('warns that the largest model is impractical without a GPU', () => {
    expect(backendAdvice({ state: 'no-adapter', f16: false })?.body).toMatch(/1\.7B/)
  })
})

describe('markdown editor transforms', () => {
  it('wraps a selection and leaves the caret around the same words', () => {
    const r = toggleWrap('make this bold', 5, 9, '**')
    expect(r.text).toBe('make **this** bold')
    expect(r.text.slice(r.start, r.end)).toBe('this')
  })

  it('unwraps when the markers are inside the selection', () => {
    const r = toggleWrap('make **this** bold', 5, 13, '**')
    expect(r.text).toBe('make this bold')
    expect(r.text.slice(r.start, r.end)).toBe('this')
  })

  // Double-clicking a word selects the word, not its markers, so a second
  // press of Bold has to look outside the selection to undo the first.
  it('unwraps when the markers sit just outside the selection', () => {
    const r = toggleWrap('make **this** bold', 7, 11, '**')
    expect(r.text).toBe('make this bold')
    expect(r.text.slice(r.start, r.end)).toBe('this')
  })

  it('round-trips: wrap then unwrap returns the original', () => {
    const original = 'alpha beta gamma'
    const wrapped = toggleWrap(original, 6, 10, '*')
    const back = toggleWrap(wrapped.text, wrapped.start, wrapped.end, '*')
    expect(back.text).toBe(original)
  })

  it('puts the caret between the markers when nothing is selected', () => {
    const r = toggleWrap('ab', 1, 1, '**')
    expect(r.text).toBe('a****b')
    expect(r.start).toBe(3)
    expect(r.end).toBe(3)
  })

  it('prefixes every line the selection touches', () => {
    const r = toggleLinePrefix('one\ntwo\nthree', 1, 6, '- ')
    expect(r.text).toBe('- one\n- two\nthree')
  })

  it('completes a partly prefixed selection instead of clearing it', () => {
    const r = toggleLinePrefix('- one\ntwo', 0, 9, '- ')
    expect(r.text).toBe('- - one\n- two')
  })

  it('removes the prefix only when every touched line has it', () => {
    const r = toggleLinePrefix('- one\n- two', 0, 11, '- ')
    expect(r.text).toBe('one\ntwo')
  })

  it('numbers lines from one and strips numbering again', () => {
    const on = toggleOrderedList('a\nb\nc', 0, 5)
    expect(on.text).toBe('1. a\n2. b\n3. c')
    const off = toggleOrderedList(on.text, on.start, on.end)
    expect(off.text).toBe('a\nb\nc')
  })

  it('keeps selected text as the link label and selects the url placeholder', () => {
    const r = insertLink('see docs here', 4, 8)
    expect(r.text).toBe('see [docs](url) here')
    expect(r.text.slice(r.start, r.end)).toBe('url')
  })

  it('counts words without being fooled by extra whitespace', () => {
    expect(textStats('  one   two \n three  ').words).toBe(3)
    expect(textStats('').words).toBe(0)
    expect(textStats('   ').words).toBe(0)
  })
})

describe('undo and redo shortcuts', () => {
  const MAC = true
  const WIN = false

  it('uses Cmd on Mac and Ctrl on Windows for undo', () => {
    expect(isUndo({ key: 'z', metaKey: true }, MAC)).toBe(true)
    expect(isUndo({ key: 'z', ctrlKey: true }, WIN)).toBe(true)
  })

  // Ctrl+Z is not undo on a Mac, and firing on it would hijack a keystroke
  // that means something else there.
  it('does not treat the wrong modifier as undo', () => {
    expect(isUndo({ key: 'z', ctrlKey: true }, MAC)).toBe(false)
    expect(isUndo({ key: 'z', metaKey: true }, WIN)).toBe(false)
    expect(isUndo({ key: 'z' }, WIN)).toBe(false)
  })

  it('treats Shift+Z as redo on both platforms', () => {
    expect(isRedo({ key: 'z', metaKey: true, shiftKey: true }, MAC)).toBe(true)
    expect(isRedo({ key: 'z', ctrlKey: true, shiftKey: true }, WIN)).toBe(true)
  })

  it('accepts Ctrl+Y on Windows only, since Cmd+Y is not a Mac convention', () => {
    expect(isRedo({ key: 'y', ctrlKey: true }, WIN)).toBe(true)
    expect(isRedo({ key: 'y', metaKey: true }, MAC)).toBe(false)
  })

  it('never reports the same keystroke as both undo and redo', () => {
    const events: KeyLike[] = [
      { key: 'z', metaKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
      { key: 'z', ctrlKey: true },
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ]
    for (const mac of [MAC, WIN]) {
      for (const e of events) {
        expect(isUndo(e, mac) && isRedo(e, mac), JSON.stringify({ e, mac })).toBe(false)
      }
    }
  })

  it('ignores the shortcuts when Alt is held', () => {
    expect(isUndo({ key: 'z', ctrlKey: true, altKey: true }, WIN)).toBe(false)
    expect(isRedo({ key: 'y', ctrlKey: true, altKey: true }, WIN)).toBe(false)
  })

  it('leaves Ctrl+R alone so browser reload keeps working', () => {
    const reload: KeyLike = { key: 'r', ctrlKey: true }
    expect(isUndo(reload, WIN)).toBe(false)
    expect(isRedo(reload, WIN)).toBe(false)
  })

  // Undo inside a prompt box should undo typing, not the whole canvas.
  it('recognises fields where the browser should keep its own undo', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'input' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(
      isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('labels shortcuts in the platform notation', () => {
    expect(shortcutLabels(MAC).undo).toBe('⌘Z')
    expect(shortcutLabels(WIN).undo).toBe('Ctrl+Z')
  })
})

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

  it('never returns an empty string', () => {
    for (const d of [0, SEC, MIN, HOUR, DAY, 7 * DAY, 40 * DAY, 400 * DAY]) {
      expect(formatRelativeTime(ago(d), NOW).length).toBeGreaterThan(0)
    }
  })
})

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

  it('removes the parameter cleanly', () => {
    const href = withoutSessionParam(withSessionParam(`${BASE}?keep=yes`, 'c-abc'))
    expect(sessionIdFromSearch(new URL(href).search)).toBeNull()
    expect(new URL(href).searchParams.get('keep')).toBe('yes')
  })

  it('hands back the input unchanged rather than throwing on a bad URL', () => {
    expect(withSessionParam('not a url', 'c-abc')).toBe('not a url')
    expect(withoutSessionParam('not a url')).toBe('not a url')
  })
})

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

describe('committing a typed number', () => {
  const MIN = 16
  const MAX = 2048
  const CURRENT = 256

  // The bug this replaces: clamping per keystroke meant typing "512" produced
  // 5, which snapped to 16, and every later digit landed after it.
  it('accepts a value whose first digits are below the minimum', () => {
    // Each of these is a partial state while typing "512"; none should commit.
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

  it('survives an inverted range instead of returning something impossible', () => {
    expect(clamp(50, 100, 10)).toBe(100)
  })

  it('offers only presets the model can actually hold', () => {
    expect(presetsWithin([128, 256, 512, 1024, 2048], 16, 2048)).toEqual([
      128, 256, 512, 1024, 2048,
    ])
    // A 2048-token model should not be offered 4096 as a one-click choice.
    expect(presetsWithin([128, 256, 4096], 16, 2048)).toEqual([128, 256])
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

  it('keeps every session it was given', () => {
    const list = [s('a', 200), s('open', 100), s('b', 300)]
    expect(orderSessions(list, 'open')).toHaveLength(3)
  })

  it('handles an empty list', () => {
    expect(orderSessions([], 'open')).toEqual([])
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

  it('leaves headroom rather than filling the window exactly', () => {
    const out = effectiveMaxNewTokens(BIG, 1000, 'auto')
    expect(out + 1000).toBeLessThan(8192)
  })

  it('honours an explicit cap when there is room for it', () => {
    expect(effectiveMaxNewTokens(BIG, 100, 512)).toBe(512)
  })

  it('never lets an explicit cap exceed the model window', () => {
    expect(effectiveMaxNewTokens(TINY, 0, 99999)).toBeLessThanOrEqual(2048)
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

  it('leaves an explicit cap alone once the prompt is short again', () => {
    expect(effectiveMaxNewTokens(TINY, 100, 512)).toBe(512)
  })

  it('reports the model maximum independently of any prompt', () => {
    expect(modelMaxNewTokens(TINY)).toBe(2048)
    expect(modelMaxNewTokens(BIG)).toBe(8192)
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

describe('run list', () => {
  const run = (id: string, over: Partial<Run> = {}): Run => ({
    id,
    status: 'done',
    text: `output ${id}`,
    model: DEFAULT_MODEL,
    ...over,
  })

  it('shows the newest run first', () => {
    const out = orderRunsNewestFirst([run('a'), run('b'), run('c')])
    expect(out.map((d) => d.run.id)).toEqual(['c', 'b', 'a'])
  })

  /*
   * Numbering follows creation, not screen position. Numbering top-down would
   * rename every earlier run each time a new one arrived, so "run 2" would mean
   * something different a minute later.
   */
  it('numbers runs by when they were created, not where they appear', () => {
    const out = orderRunsNewestFirst([run('a'), run('b'), run('c')])
    expect(out.map((d) => d.number)).toEqual([3, 2, 1])
    expect(out.find((d) => d.run.id === 'a')?.number).toBe(1)
  })

  it('handles no runs at all', () => {
    expect(orderRunsNewestFirst([])).toEqual([])
  })

  it('opens the newest by default and leaves the rest closed', () => {
    expect(isRunOpen(run('a'), true, {})).toBe(true)
    expect(isRunOpen(run('a'), false, {})).toBe(false)
  })

  // Collapsing live output would hide the thing being waited for.
  it('always opens a run that is still producing tokens', () => {
    expect(isRunOpen(run('a', { status: 'streaming' }), false, {})).toBe(true)
    expect(isRunOpen(run('a', { status: 'loading' }), false, {})).toBe(true)
  })

  it('lets an explicit toggle win over every default', () => {
    expect(isRunOpen(run('a'), true, { a: false })).toBe(false)
    expect(isRunOpen(run('a', { status: 'streaming' }), false, { a: false })).toBe(false)
    expect(isRunOpen(run('a'), false, { a: true })).toBe(true)
  })

  it('previews a collapsed run on one line', () => {
    const preview = runPreview(run('a', { text: 'line one\nline two\n\nline three' }))
    expect(preview).toBe('line one line two line three')
    expect(preview).not.toContain('\n')
  })

  it('truncates a long preview and says so', () => {
    const preview = runPreview(run('a', { text: 'x'.repeat(500) }), 20)
    expect(preview).toHaveLength(21)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('describes a run with nothing to preview', () => {
    expect(runPreview(run('a', { text: '', status: 'done' }))).toBe('(empty response)')
    expect(runPreview(run('a', { text: '', status: 'streaming' }))).toBe('no output yet')
  })

  it('previews the error when a run failed', () => {
    expect(runPreview(run('a', { text: '', error: 'out of memory' }))).toBe('out of memory')
  })
})
