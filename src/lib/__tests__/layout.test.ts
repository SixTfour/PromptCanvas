import { describe, expect, it } from 'vitest'
import { starter, withMerge } from '../../test/fixtures'
import { layoutCanvas } from '../layout'

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
