import { buildStarterCanvas } from '../data/starterCanvas'
import { DEFAULT_MODEL } from '../lib/models'
import type { Canvas } from '../types'

/**
 * Canvases shared by the tests that need a real graph.
 *
 * The starter canvas is used rather than a hand-built one so the fixtures stay
 * honest: if the shipped starting point ever stopped composing or laying out
 * correctly, these tests would notice.
 */
export const starter: Canvas = buildStarterCanvas()

/**
 * The starter canvas plus a merge node.
 *
 * The starter ships two sibling branches and no merge, because merging is
 * something the user does. DAG behaviour still needs covering, so this builds
 * the merge the way the store's `addMergeNode` would: a new node with an edge
 * from each parent, rather than re-parenting anything.
 */
export const withMerge: Canvas = {
  ...starter,
  nodes: [
    ...starter.nodes,
    {
      id: 'n-merged',
      type: 'merge',
      position: { x: 0, y: 0 },
      data: {
        title: 'Merged',
        mergedFrom: ['n-terse', 'n-severity'],
        blocks: [
          { id: 'b-m', label: 'merged', kind: 'correction', enabled: true, text: 'Do both.' },
        ],
        model: DEFAULT_MODEL,
        maxNewTokens: 'auto',
        runs: [],
      },
    },
  ],
  edges: [
    ...starter.edges,
    { id: 'e-tm', source: 'n-terse', target: 'n-merged', kind: 'merge' },
    { id: 'e-sm', source: 'n-severity', target: 'n-merged', kind: 'merge' },
  ],
}
