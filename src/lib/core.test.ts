import { describe, expect, it } from 'vitest'
import { buildStarterCanvas } from '../data/starterCanvas'
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
import { layoutCanvas } from './layout'
import {
  DEFAULT_MODEL,
  MODELS,
  MODEL_IDS,
  contextPressure,
  estimateTokens,
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
