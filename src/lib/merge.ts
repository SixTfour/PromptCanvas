import type { Canvas, CanvasNode, ContextBlock, ModelId } from '../types'

/**
 * Telling a merge node when the branches under it have moved on.
 *
 * A merge is a snapshot. Diff & Merge reads the two source nodes' blocks,
 * produces one reconciled block, and from then on that block is all the merged
 * prompt carries — composition skips the sources outright, because sending both
 * corrections *and* the reconciliation of them hands the model the argument the
 * merge existed to settle.
 *
 * That makes drift invisible in the worst way. Edit a branch after merging and
 * the merged node keeps generating from text that no longer matches its parent,
 * with nothing on screen to say so. So each merge records a fingerprint of what
 * it consumed, and anything that no longer matches is reported.
 */

/**
 * What a merge saw, per source node.
 *
 * Diff & Merge reads `node.data.blocks` filtered to the enabled ones, so the
 * fingerprint covers exactly that and nothing above it: kind, label and text,
 * in order. Disabled blocks are excluded because the merge never saw them,
 * which means toggling one back on correctly reads as a change.
 *
 * Runs are deliberately not included. Merging can draw on the branches' latest
 * outputs, but runs are append-only and generation is greedy, so folding them
 * in would mark every merge stale the moment someone re-ran a branch and got
 * back the identical text.
 */
export function sourceFingerprint(node: CanvasNode): string {
  const parts = node.data.blocks
    .filter((b) => b.enabled)
    .map((b) => `${b.kind}\u0000${b.label}\u0000${b.text}`)
  return hash(parts.join('\u0001'))
}

/** The basis to store on a merge node built from these two sources. */
export function mergeBasisFor(canvas: Canvas, sources: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of sources) {
    const node = canvas.nodes.find((n) => n.id === id)
    if (node) out[id] = sourceFingerprint(node)
  }
  return out
}

/**
 * Source nodes that have changed since this node was merged, in `mergedFrom`
 * order.
 *
 * Empty for anything that is not a merge, and empty when no basis was recorded
 * — merges predating this bookkeeping cannot be judged, and a tool that cries
 * wolf on every old canvas would train people to ignore the flag. A source that
 * has since been deleted does not count as changed either; the missing parent
 * is the canvas's problem to show, not this one's.
 */
export function staleMergeSources(canvas: Canvas, nodeId: string): string[] {
  const node = canvas.nodes.find((n) => n.id === nodeId)
  const sources = node?.data.mergedFrom
  const basis = node?.data.mergeBasis
  if (!sources || !basis) return []

  return sources.filter((id) => {
    const recorded = basis[id]
    if (!recorded) return false
    const current = canvas.nodes.find((n) => n.id === id)
    return current ? sourceFingerprint(current) !== recorded : false
  })
}

export function isMergeStale(canvas: Canvas, nodeId: string): boolean {
  return staleMergeSources(canvas, nodeId).length > 0
}

/**
 * FNV-1a, 32-bit, with the input length appended.
 *
 * A cryptographic digest would mean pulling in a dependency or going async
 * through SubtleCrypto for a string comparison that drives a badge. A collision
 * costs a flag that fails to appear, never a wrong edit, so the length suffix is
 * cheap insurance and the tradeoff is the right way round.
 */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}-${s.length.toString(36)}`
}

/**
 * The two branches a merge can be rebuilt from, or null if it cannot be.
 *
 * A branch that has since been deleted takes the rebuild with it: there is
 * nothing to diff against, and silently merging against one parent would
 * quietly change what the node means.
 */
export function rebuildSources(canvas: Canvas, mergeId: string): [string, string] | null {
  const node = canvas.nodes.find((n) => n.id === mergeId)
  const sources = node?.data.mergedFrom
  if (!sources) return null
  const present = sources.filter((id) => canvas.nodes.some((n) => n.id === id))
  return present.length === 2 ? [present[0], present[1]] : null
}

/**
 * A merge node rebuilt around newer text, or null if `mergeId` is not a merge.
 *
 * A rebuild is the same decision made again with better information, so it
 * belongs in the same place: the node keeps its id, position, edges, title and
 * run history, and anything branched off it stays attached. Only the merged
 * block's text changes — the block keeps its own id and heading, because the
 * heading is part of the prompt and the user may have written it.
 *
 * `model` is optional because a rebuild is usually about the text; passing one
 * re-points the node at a different model in the same step, which is the same
 * choice the merge dialog offers when the node is first created.
 */
export function rebuiltMergeNode(
  canvas: Canvas,
  mergeId: string,
  mergedText: string,
  model?: ModelId,
): CanvasNode | null {
  const node = canvas.nodes.find((n) => n.id === mergeId)
  if (!node?.data.mergedFrom) return null
  // The merged correction, not merely the first block: carried context sits
  // ahead of it, and a rebuild must keep the heading the user may have written.
  const existing = node.data.blocks.find((b) => b.kind === 'correction')
  return {
    ...node,
    data: {
      ...node.data,
      blocks: mergedBlocks(canvas, node.data.mergedFrom, mergedText, {
        id: existing?.id ?? `${node.id}-merged`,
        label: existing?.label ?? 'merged correction',
      }),
      model: model ?? node.data.model,
      mergeBasis: mergeBasisFor(canvas, node.data.mergedFrom),
    },
  }
}

/**
 * The correction text a branch brings to a merge.
 *
 * Diff & Merge used to flatten every enabled block into one string regardless
 * of kind, which diffed one branch's source material against the other's
 * instructions and then wrote the result back as a single correction — so a
 * context block came out the far side as something the model was told to obey,
 * override preamble and all. Corrections are what the two branches are actually
 * arguing about, so they are what gets diffed.
 */
export function correctionText(node: CanvasNode): string {
  return node.data.blocks
    .filter((b) => b.enabled && b.kind === 'correction')
    .map((b) => b.text)
    .join('\n\n')
}

/**
 * Context blocks from both branches, carried into the merge unchanged.
 *
 * They cannot simply be left behind: a merge supersedes its sources, so context
 * the merged node does not carry is gone from its prompt entirely. Identical
 * blocks — the usual case, both branches inheriting the same material — collapse
 * to one. Blocks that genuinely differ are both kept, because choosing between
 * two pieces of source material is not a thing this tool can do for you.
 *
 * Ids are derived from the source so a rebuild produces the same ones, and
 * cannot collide between two branches that were duplicated from each other.
 */
export function carriedContext(canvas: Canvas, sources: readonly string[]): ContextBlock[] {
  const out: ContextBlock[] = []
  const seen = new Set<string>()
  for (const id of sources) {
    const node = canvas.nodes.find((n) => n.id === id)
    if (!node) continue
    for (const b of node.data.blocks) {
      if (!b.enabled || b.kind !== 'context') continue
      const key = `${b.label}\u0000${b.text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...b, id: `${id}--${b.id}` })
    }
  }
  return out
}

/**
 * The full block list for a merged node: carried context, then the merged
 * correction.
 *
 * Context first so the correction reads as an amendment to it, matching how
 * `composePrompt` orders an inherited chain.
 */
export function mergedBlocks(
  canvas: Canvas,
  sources: readonly string[],
  mergedText: string,
  correction: { id: string; label: string },
): ContextBlock[] {
  return [
    ...carriedContext(canvas, sources),
    { id: correction.id, label: correction.label, kind: 'correction', enabled: true, text: mergedText },
  ]
}
