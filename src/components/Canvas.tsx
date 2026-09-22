import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NODE_H, NODE_W } from '../lib/layout'
import { useCanvas } from '../store/useCanvas'
import { PromptNode } from './nodes/PromptNode'

const nodeTypes = { prompt: PromptNode, merge: PromptNode }

export function CanvasView() {
  const canvas = useCanvas((s) => s.canvas)
  const select = useCanvas((s) => s.select)
  const moveNode = useCanvas((s) => s.moveNode)
  const selectedId = useCanvas((s) => s.selectedId)

  /**
   * React Flow's own copy of the nodes.
   *
   * The store stays the source of truth for positions and data, but React Flow
   * needs somewhere to write back what it measures. Dropping those `dimensions`
   * changes — as a handler that only looks at `position` does — leaves every
   * node without `measured`, and anything that needs a node's size then treats
   * it as having none: the minimap skips such nodes entirely and renders empty.
   */
  const [rfNodes, setRfNodes] = useState<Node[]>([])

  /**
   * Bring a newly created node into view.
   *
   * `fitView` only runs on mount, and a new branch is placed below the lowest
   * existing sibling rather than beside its parent, so the third branch off a
   * node lands outside the viewport. The button then looks broken: the node is
   * created, edged and selected, and nothing visibly happens.
   *
   * Only a single addition counts, and only when it is the node the store just
   * selected. Loading a session adds every node at once, and panning to an
   * arbitrary one of those would fight the fitView that belongs there.
   */
  const { setCenter, getZoom } = useReactFlow()
  const known = useRef<Set<string> | null>(null)

  useEffect(() => {
    const ids = canvas.nodes.map((n) => n.id)
    const previous = known.current
    known.current = new Set(ids)
    if (!previous) return

    const added = ids.filter((id) => !previous.has(id))
    if (added.length !== 1 || added[0] !== selectedId) return

    const node = canvas.nodes.find((n) => n.id === added[0])
    if (!node) return
    // Animated rather than a jump, so it stays clear where the node came from.
    void setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, {
      zoom: getZoom(),
      duration: 400,
    })
  }, [canvas.nodes, selectedId, setCenter, getZoom])

  useEffect(() => {
    setRfNodes((prev) => {
      const previous = new Map(prev.map((n) => [n.id, n]))
      return canvas.nodes.map((n) => {
        const old = previous.get(n.id)
        return {
          // Spread the old node first so measurements survive a store update.
          ...old,
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
          selected: n.id === selectedId,
          // A size to draw with on the first frame, before measurement lands.
          initialWidth: NODE_W,
          initialHeight: NODE_H,
        } as Node
      })
    })
  }, [canvas.nodes, selectedId])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds))
      for (const c of changes) {
        // Commit to the store once the drag ends rather than every frame: one
        // undo step for one drag, and no store churn mid-gesture.
        if (c.type === 'position' && c.position && c.dragging === false) {
          moveNode(c.id, c.position)
        }
      }
    },
    [moveNode],
  )

  const edges = useMemo<Edge[]>(
    () =>
      canvas.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: e.kind === 'merge',
        // Merge edges are dashed so a two-parent join reads differently from an
        // ordinary branch at a glance.
        style:
          e.kind === 'merge' ? { stroke: 'var(--color-accent)', strokeDasharray: '4 3' } : undefined,
      })),
    [canvas.edges],
  )

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => select(n.id)}
      onPaneClick={() => select(null)}
      fitView
      minZoom={0.15}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1c2130" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        style={{ background: 'var(--color-panel)' }}
        maskColor="rgba(11,13,18,0.75)"
        nodeStrokeWidth={3}
        nodeStrokeColor={(n) => (n.selected ? '#7c8cff' : 'transparent')}
        nodeColor={(n) => ((n.data as { mergedFrom?: unknown }).mergedFrom ? '#7c8cff' : '#39415a')}
      />
    </ReactFlow>
  )
}
