import type { Canvas, CanvasNode, ComposedPrompt, ContextBlock } from '../types'

/**
 * DAG walking and prompt composition.
 *
 * Because merge nodes have two parents, "the path from root" is not unique.
 * We take the deterministic union of all ancestors in topological order, which
 * is what you want for a merge: the merged node inherits context from both
 * lineages, de-duplicated, in a stable order.
 */

function nodeMap(canvas: Canvas): Map<string, CanvasNode> {
  return new Map(canvas.nodes.map((n) => [n.id, n]))
}

export function parentsOf(canvas: Canvas, nodeId: string): string[] {
  return canvas.edges.filter((e) => e.target === nodeId).map((e) => e.source)
}

/**
 * All ancestors of `nodeId`, root-first, each appearing once.
 *
 * Depth-first post-order over parents gives a stable ordering in which every
 * node appears after all of its own ancestors, which is the order the prompt
 * blocks need to be concatenated in.
 */
export function ancestorChain(canvas: Canvas, nodeId: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const visit = (id: string, guard: Set<string>) => {
    if (guard.has(id)) return // cycle guard; canvases should be acyclic but do not trust it
    guard.add(id)
    for (const p of parentsOf(canvas, id).slice().sort()) visit(p, guard)
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
    guard.delete(id)
  }

  visit(nodeId, new Set())
  return out
}

/**
 * Nodes whose own blocks a merge in the chain replaces.
 *
 * Diff & Merge builds its text from the two source nodes' own blocks, so once
 * the merged block exists those blocks are in the prompt twice: once as the
 * originals inherited through the chain, and once folded into the synthesis.
 * That is not just redundant — the synthesis exists to reconcile two
 * corrections that disagreed, and leaving the originals above it hands the
 * model both sides of an argument it was meant to be spared.
 *
 * Only the direct sources are superseded. Anything further up the chain was
 * never shown to the merge and is still genuine inherited context.
 */
function supersededBy(map: Map<string, CanvasNode>, chain: string[]): Set<string> {
  const out = new Set<string>()
  for (const id of chain) {
    const n = map.get(id)
    if (!n?.data.mergedFrom) continue
    // An emptied merge supersedes nothing; otherwise deleting the merged block
    // would silently delete both branches' work along with it.
    if (!n.data.blocks.some((b) => b.enabled)) continue
    for (const source of n.data.mergedFrom) out.add(source)
  }
  return out
}

/**
 * Build the prompt for a node.
 *
 * `sharedPrefixLength` is the number of leading blocks this node has in common
 * with its siblings — everything inherited. Putting the prompt cache breakpoint
 * there means running five sibling branches pays full price for the shared
 * context once and cache-read price four times.
 */
export function composePrompt(canvas: Canvas, nodeId: string): ComposedPrompt {
  const map = nodeMap(canvas)
  const chain = ancestorChain(canvas, nodeId)

  /*
   * The instruction belongs to the node that declares it, not to the end of
   * the prompt.
   *
   * A branch's blocks are amendments to everything above them — "the last
   * attempt buried the steps, do this instead" only means something once the
   * thing being amended has been stated. Rendering the inherited task last
   * pushed every correction into the middle of the prompt, where it reads as
   * background rather than as the most recent instruction.
   *
   * The chain is root-first and the node itself is last, so the final node
   * that sets an instruction is the nearest one, and a branch can still
   * override its parent's framing.
   */
  let system = ''
  let instruction = ''
  let instructionOwner: string | null = null
  for (const id of chain) {
    const n = map.get(id)
    if (!n) continue
    if (n.data.system?.trim()) system = n.data.system.trim()
    if (n.data.instruction?.trim()) {
      instruction = n.data.instruction.trim()
      instructionOwner = id
    }
  }

  const blocks: ComposedPrompt['blocks'] = []
  const sections: string[] = []
  let sharedPrefixLength = 0

  const superseded = supersededBy(map, chain)

  for (const id of chain) {
    const n = map.get(id)
    if (!n) continue

    // Skipped for blocks only: a superseded node can still own the task, and
    // dropping that would leave the prompt with nothing to do.
    if (!superseded.has(id)) {
      for (const b of n.data.blocks) {
        if (!b.enabled) continue
        blocks.push({ ...b, fromNodeId: id, inherited: id !== nodeId })
        const body = b.kind === 'correction' ? correctionBody(b.text) : b.text
        sections.push(renderSection(b.label.trim() || KIND_HEADING[b.kind], body))
      }
    }

    // Emitted here rather than at the end, so anything a descendant adds lands
    // after the task it is amending.
    if (id === instructionOwner && instruction) sections.push(renderSection('Task', instruction))

    if (id !== nodeId) sharedPrefixLength = blocks.length
  }

  return {
    system,
    blocks,
    instruction,
    sharedPrefixLength,
    text: sections.join(`

`),
  }
}

/**
 * What a correction block says before its own text.
 *
 * Without it a correction is indistinguishable from context: `## correction`
 * reads as a section of a document rather than an instruction, and the model
 * narrates around it. Measured on SmolLM2 1.7B with "fly out of Colorado
 * Springs instead of Denver" as the correction — the model ignored it under
 * the bare heading, under a more directive heading, with the correction placed
 * before the task, and folded into the task itself. This phrasing is the one
 * that made it comply, so it is the one that ships.
 *
 * It is injected, not hidden: the Composed tab shows the prompt verbatim, and
 * only blocks the user marked as a correction get it.
 */
const CORRECTION_PREAMBLE =
  'Revise your answer so that it follows this, overriding anything above that conflicts:'

function correctionBody(text: string): string {
  return `${CORRECTION_PREAMBLE}
${text.trim()}`
}

/** One `## Heading` section. Block labels are the headings the model sees. */
function renderSection(heading: string, body: string): string {
  return `## ${heading}
${body.trim()}`
}

const KIND_HEADING: Record<ContextBlock['kind'], string> = {
  context: 'Context',
  correction: 'Correction',
}

