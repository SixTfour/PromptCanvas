import { describe, expect, it } from 'vitest'
import { withMerge } from '../../test/fixtures'
import type { Canvas, ContextBlock } from '../../types'
import {
  carriedContext,
  correctionText,
  isMergeStale,
  mergeBasisFor,
  mergedBlocks,
  rebuildSources,
  rebuiltMergeNode,
  sourceFingerprint,
  staleMergeSources,
} from '../merge'

/**
 * The fixture merges `n-terse` and `n-severity`, but predates the basis being
 * recorded, so every test here starts by stamping one on — which is also what
 * `migrateCanvas` does to older canvases on load.
 */
const stamped: Canvas = {
  ...withMerge,
  nodes: withMerge.nodes.map((n) =>
    n.id === 'n-merged'
      ? { ...n, data: { ...n.data, mergeBasis: mergeBasisFor(withMerge, n.data.mergedFrom!) } }
      : n,
  ),
}

const editBlock = (canvas: Canvas, nodeId: string, patch: Partial<ContextBlock>): Canvas => ({
  ...canvas,
  nodes: canvas.nodes.map((n) =>
    n.id === nodeId
      ? { ...n, data: { ...n.data, blocks: n.data.blocks.map((b) => ({ ...b, ...patch })) } }
      : n,
  ),
})

describe('a merge that has fallen behind its branches', () => {
  it('is current the moment it is made', () => {
    expect(staleMergeSources(stamped, 'n-merged')).toEqual([])
    expect(isMergeStale(stamped, 'n-merged')).toBe(false)
  })

  /*
   * The case that motivated this. A merged node composes from its own block
   * alone, so editing a branch afterwards changes nothing about the merged
   * prompt — which is correct, and completely invisible without a flag.
   */
  it('names the branch whose text changed', () => {
    const edited = editBlock(stamped, 'n-terse', { text: 'Something else entirely.' })
    expect(staleMergeSources(edited, 'n-merged')).toEqual(['n-terse'])
  })

  it('reports both branches when both moved', () => {
    let edited = editBlock(stamped, 'n-terse', { text: 'A.' })
    edited = editBlock(edited, 'n-severity', { text: 'B.' })
    expect(staleMergeSources(edited, 'n-merged')).toHaveLength(2)
  })

  it('notices a heading change, since the heading is part of the prompt', () => {
    const edited = editBlock(stamped, 'n-terse', { label: 'renamed' })
    expect(isMergeStale(edited, 'n-merged')).toBe(true)
  })

  it('notices a block being switched to a correction', () => {
    // The kind decides whether the block is sent as an override, so it is a
    // change to what the branch says even when the words are identical.
    const edited = editBlock(stamped, 'n-terse', { kind: 'context' })
    expect(isMergeStale(edited, 'n-merged')).toBe(true)
  })

  it('notices a block being disabled', () => {
    const edited = editBlock(stamped, 'n-terse', { enabled: false })
    expect(isMergeStale(edited, 'n-merged')).toBe(true)
  })

  it('ignores edits to the merged node itself', () => {
    // Rewriting the merged block is the user resolving the merge, not drift.
    const edited = editBlock(stamped, 'n-merged', { text: 'Reconciled by hand.' })
    expect(isMergeStale(edited, 'n-merged')).toBe(false)
  })

  it('ignores edits elsewhere on the canvas', () => {
    const edited = editBlock(stamped, 'n-root', { text: 'A different bug report.' })
    expect(isMergeStale(edited, 'n-merged')).toBe(false)
  })

  it('ignores a new run on a branch', () => {
    // Runs are append-only and generation is greedy, so folding them in would
    // mark every merge stale for re-running a branch and getting the same text.
    const edited: Canvas = {
      ...stamped,
      nodes: stamped.nodes.map((n) =>
        n.id === 'n-terse'
          ? {
              ...n,
              data: {
                ...n.data,
                runs: [
                  { id: 'r1', status: 'done' as const, text: 'output', model: n.data.model },
                ],
              },
            }
          : n,
      ),
    }
    expect(isMergeStale(edited, 'n-merged')).toBe(false)
  })
})

describe('things that cannot be judged are not flagged', () => {
  it('says nothing about a node that is not a merge', () => {
    expect(staleMergeSources(stamped, 'n-terse')).toEqual([])
    expect(staleMergeSources(stamped, 'n-root')).toEqual([])
  })

  it('says nothing about a merge with no recorded basis', () => {
    // Crying wolf on every canvas made before this existed would teach people
    // to ignore the badge, which costs more than the missed warnings.
    expect(staleMergeSources(withMerge, 'n-merged')).toEqual([])
  })

  it('says nothing about a node that does not exist', () => {
    expect(staleMergeSources(stamped, 'nope')).toEqual([])
  })

  it('does not report a deleted branch as changed', () => {
    const pruned: Canvas = { ...stamped, nodes: stamped.nodes.filter((n) => n.id !== 'n-terse') }
    // The missing parent is the canvas's problem to show, not this flag's.
    expect(staleMergeSources(pruned, 'n-merged')).toEqual([])
  })
})

describe('the fingerprint', () => {
  const node = withMerge.nodes.find((n) => n.id === 'n-terse')!

  it('is stable across calls', () => {
    expect(sourceFingerprint(node)).toBe(sourceFingerprint(node))
  })

  it('separates text that differs only by where a block boundary falls', () => {
    const joined = {
      ...node,
      data: {
        ...node.data,
        blocks: [{ id: 'b', kind: 'context' as const, label: '', text: 'ab', enabled: true }],
      },
    }
    const split = {
      ...node,
      data: {
        ...node.data,
        blocks: [
          { id: 'b1', kind: 'context' as const, label: '', text: 'a', enabled: true },
          { id: 'b2', kind: 'context' as const, label: '', text: 'b', enabled: true },
        ],
      },
    }
    expect(sourceFingerprint(joined)).not.toBe(sourceFingerprint(split))
  })

  it('ignores block ids, which change on every duplicate', () => {
    const renumbered = {
      ...node,
      data: { ...node.data, blocks: node.data.blocks.map((b) => ({ ...b, id: `${b.id}-copy` })) },
    }
    expect(sourceFingerprint(renumbered)).toBe(sourceFingerprint(node))
  })
})

describe('rebuilding a stale merge', () => {
  const drifted = editBlock(stamped, 'n-terse', { text: 'Something else entirely.' })

  it('offers the two branches it came from', () => {
    expect(rebuildSources(drifted, 'n-merged')).toEqual(['n-terse', 'n-severity'])
  })

  it('refuses when a branch has been deleted', () => {
    // Merging against one parent would quietly change what the node means.
    const pruned: Canvas = { ...drifted, nodes: drifted.nodes.filter((n) => n.id !== 'n-terse') }
    expect(rebuildSources(pruned, 'n-merged')).toBeNull()
  })

  it('refuses on a node that was never a merge', () => {
    expect(rebuildSources(drifted, 'n-terse')).toBeNull()
    expect(rebuiltMergeNode(drifted, 'n-terse', 'text')).toBeNull()
  })

  it('is current again once rebuilt', () => {
    const rebuilt = rebuiltMergeNode(drifted, 'n-merged', 'Reconciled.')!
    const next: Canvas = {
      ...drifted,
      nodes: drifted.nodes.map((n) => (n.id === 'n-merged' ? rebuilt : n)),
    }
    expect(staleMergeSources(next, 'n-merged')).toEqual([])
  })

  it('keeps the node in place, with its edges and runs', () => {
    const before = drifted.nodes.find((n) => n.id === 'n-merged')!
    const after = rebuiltMergeNode(drifted, 'n-merged', 'Reconciled.')!
    // A rebuild is the same decision made again, so anything branched off this
    // node has to stay attached to it.
    expect(after.id).toBe(before.id)
    expect(after.position).toEqual(before.position)
    expect(after.data.title).toBe(before.data.title)
    expect(after.data.mergedFrom).toEqual(before.data.mergedFrom)
    expect(after.data.runs).toBe(before.data.runs)
  })

  it('keeps the block id and heading, and replaces only the text', () => {
    const before = drifted.nodes.find((n) => n.id === 'n-merged')!.data.blocks[0]
    const after = rebuiltMergeNode(drifted, 'n-merged', 'Reconciled.')!.data.blocks
    expect(after).toHaveLength(1)
    // The heading is part of the prompt and may have been written by the user.
    expect(after[0].id).toBe(before.id)
    expect(after[0].label).toBe(before.label)
    expect(after[0].text).toBe('Reconciled.')
    expect(after[0].kind).toBe('correction')
  })

  it('does not mutate the canvas it was given', () => {
    const snapshot = JSON.stringify(drifted)
    rebuiltMergeNode(drifted, 'n-merged', 'Reconciled.')
    expect(JSON.stringify(drifted)).toBe(snapshot)
  })
})

/*
 * Diff & Merge used to flatten every enabled block into one string regardless
 * of kind. That diffed one branch's source material against the other's
 * instructions, and wrote the result back as a single correction — so context
 * came out the far side as something the model was told to obey, override
 * preamble and all.
 */
describe('context and corrections do not get folded together', () => {
  const mixed = (nodeId: string, blocks: ContextBlock[]): Canvas => ({
    ...stamped,
    nodes: stamped.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, blocks } } : n)),
  })

  const block = (over: Partial<ContextBlock>): ContextBlock => ({
    id: 'b',
    kind: 'context',
    label: '',
    text: '',
    enabled: true,
    ...over,
  })

  const twoKinds = () => {
    let c = mixed('n-terse', [
      block({ id: 'x', kind: 'context', label: 'Spec', text: 'The spec.' }),
      block({ id: 'c1', kind: 'correction', text: 'Be terse.' }),
    ])
    c = {
      ...c,
      nodes: c.nodes.map((n) =>
        n.id === 'n-severity'
          ? {
              ...n,
              data: {
                ...n.data,
                blocks: [
                  block({ id: 'y', kind: 'context', label: 'Spec', text: 'The spec.' }),
                  block({ id: 'c2', kind: 'correction', text: 'Lead with severity.' }),
                ],
              },
            }
          : n,
      ),
    }
    return c
  }

  it('diffs only the corrections', () => {
    const c = twoKinds()
    expect(correctionText(c.nodes.find((n) => n.id === 'n-terse')!)).toBe('Be terse.')
    expect(correctionText(c.nodes.find((n) => n.id === 'n-severity')!)).toBe('Lead with severity.')
  })

  it('leaves disabled corrections out', () => {
    const c = mixed('n-terse', [block({ kind: 'correction', text: 'Off.', enabled: false })])
    expect(correctionText(c.nodes.find((n) => n.id === 'n-terse')!)).toBe('')
  })

  it('carries context through rather than merging or dropping it', () => {
    const carried = carriedContext(twoKinds(), ['n-terse', 'n-severity'])
    expect(carried.map((b) => b.text)).toEqual(['The spec.'])
    expect(carried[0].kind).toBe('context')
  })

  it('collapses context both branches share, and keeps context that differs', () => {
    const c = mixed('n-terse', [block({ id: 'x', label: 'Spec', text: 'Only here.' })])
    const carried = carriedContext(c, ['n-terse', 'n-severity'])
    // The starter's other branch has its own block, so both survive.
    expect(carried.length).toBeGreaterThanOrEqual(1)
    expect(new Set(carried.map((b) => b.id)).size).toBe(carried.length)
  })

  it('never turns a context block into a correction', () => {
    const blocks = mergedBlocks(twoKinds(), ['n-terse', 'n-severity'], 'Both.', {
      id: 'm',
      label: 'merged correction',
    })
    // The bug: a context block written back as a correction would be sent with
    // the override preamble, telling the model to obey its own source material.
    const context = blocks.filter((b) => b.kind === 'context')
    expect(context.map((b) => b.text)).toEqual(['The spec.'])
    expect(blocks.filter((b) => b.kind === 'correction')).toHaveLength(1)
  })

  it('puts the merged correction last, so it amends the context', () => {
    const blocks = mergedBlocks(twoKinds(), ['n-terse', 'n-severity'], 'Both.', {
      id: 'm',
      label: 'merged correction',
    })
    expect(blocks.at(-1)).toMatchObject({ kind: 'correction', text: 'Both.' })
  })

  it('gives carried blocks ids that cannot collide between branches', () => {
    // Two branches duplicated from each other carry the same block ids, which
    // would break React keys and per-block editing on the merged node.
    const clashing = mixed('n-terse', [block({ id: 'same', text: 'A' })])
    const both = {
      ...clashing,
      nodes: clashing.nodes.map((n) =>
        n.id === 'n-severity'
          ? { ...n, data: { ...n.data, blocks: [block({ id: 'same', text: 'B' })] } }
          : n,
      ),
    }
    const carried = carriedContext(both, ['n-terse', 'n-severity'])
    expect(carried).toHaveLength(2)
    expect(carried[0].id).not.toBe(carried[1].id)
  })

  it('survives a branch with no corrections at all', () => {
    const c = mixed('n-terse', [block({ text: 'Just material.' })])
    expect(correctionText(c.nodes.find((n) => n.id === 'n-terse')!)).toBe('')
    expect(carriedContext(c, ['n-terse'])).toHaveLength(1)
  })
})
