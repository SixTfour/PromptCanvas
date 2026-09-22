import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import { useCanvas } from '../store/useCanvas'
import { PromptNode } from './nodes/PromptNode'

const nodeTypes = { prompt: PromptNode, merge: PromptNode }

export function CanvasView() {
  const canvas = useCanvas((s) => s.canvas)
  const select = useCanvas((s) => s.select)
  const moveNode = useCanvas((s) => s.moveNode)
  const selectedId = useCanvas((s) => s.selectedId)

  const nodes = useMemo<Node[]>(
    () =>
      canvas.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
        selected: n.id === selectedId,
      })),
    [canvas.nodes, selectedId],
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
          e.kind === 'merge'
            ? { stroke: 'var(--color-accent)', strokeDasharray: '4 3' }
            : undefined,
      })),
    [canvas.edges],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position) moveNode(c.id, c.position)
      }
    },
    [moveNode],
  )

  return (
    <ReactFlow
      nodes={nodes}
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
        nodeColor={(n) => ((n.data as { mergedFrom?: unknown }).mergedFrom ? '#7c8cff' : '#2c3342')}
      />
    </ReactFlow>
  )
}
