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
  const self = map.get(nodeId)

  const blocks: ComposedPrompt['blocks'] = []
  let system = ''
  let instruction = ''
  let sharedPrefixLength = 0

  for (const id of chain) {
    const n = map.get(id)
    if (!n) continue
    // The nearest ancestor that sets a system prompt or instruction wins, so a
    // branch can override the root's framing without restating everything.
    if (n.data.system?.trim()) system = n.data.system.trim()
    if (n.data.instruction?.trim()) instruction = n.data.instruction.trim()

    for (const b of n.data.blocks) {
      if (!b.enabled) continue
      blocks.push({ ...b, fromNodeId: id, inherited: id !== nodeId })
    }
    if (id !== nodeId) sharedPrefixLength = blocks.length
  }

  if (self?.data.instruction?.trim()) instruction = self.data.instruction.trim()

  return {
    system,
    blocks,
    instruction,
    sharedPrefixLength,
    text: renderPromptText(blocks, instruction),
  }
}

const KIND_HEADING: Record<ContextBlock['kind'], string> = {
  context: 'Context',
  correction: 'Correction',
  example: 'Example',
}

/** The rendering of a composed prompt's user turn. Internal to composePrompt. */
function renderPromptText(
  blocks: Array<Pick<ContextBlock, 'label' | 'text' | 'kind'>>,
  instruction: string,
): string {
  const parts: string[] = []
  for (const b of blocks) {
    const heading = b.label.trim() || KIND_HEADING[b.kind]
    parts.push(`## ${heading}\n${b.text.trim()}`)
  }
  if (instruction.trim()) parts.push(`## Task\n${instruction.trim()}`)
  return parts.join('\n\n')
}
