import dagre from '@dagrejs/dagre'
import type { Canvas } from '../types'

/**
 * Auto-layout.
 *
 * Dagre handles DAGs, which matters here: a merge node has two incoming edges,
 * and a tree layout would either duplicate it or refuse. Left-to-right, because
 * a prompt lineage reads as a progression and branches stack vertically.
 */

// Kept in step with the card in components/nodes/PromptNode.tsx. The card is
// sized around its output panel, so these grow when that does.
const NODE_W = 320
const NODE_H = 232

export function layoutCanvas(canvas: Canvas): Canvas {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 44, ranksep: 110, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of canvas.nodes) {
    g.setNode(n.id, { width: NODE_W, height: n.data.collapsed ? 64 : NODE_H })
  }
  for (const e of canvas.edges) {
    // Skip edges pointing at nodes that no longer exist, or dagre throws.
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  return {
    ...canvas,
    nodes: canvas.nodes.map((n) => {
      const pos = g.node(n.id)
      if (!pos) return n
      // Dagre reports centres; React Flow wants top-left.
      return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - pos.height / 2 } }
    }),
  }
}

/** Where to drop a new child so it does not land on top of an existing one. */
export function placeChild(canvas: Canvas, parentId: string): { x: number; y: number } {
  const parent = canvas.nodes.find((n) => n.id === parentId)
  if (!parent) return { x: 0, y: 0 }
  const siblings = canvas.edges
    .filter((e) => e.source === parentId)
    .map((e) => canvas.nodes.find((n) => n.id === e.target))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))

  const x = parent.position.x + NODE_W + 110
  if (siblings.length === 0) return { x, y: parent.position.y }
  const lowest = Math.max(...siblings.map((s) => s.position.y))
  return { x, y: lowest + NODE_H + 44 }
}
