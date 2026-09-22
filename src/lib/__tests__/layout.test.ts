import { describe, expect, it } from 'vitest'
import { starter, withMerge } from '../../test/fixtures'
import { NODE_H, layoutCanvas, placeChild } from '../layout'

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

/*
 * Where a new branch lands is why the canvas pans to it. A third branch off a
 * node is placed below the second, not beside the parent, so it can easily be
 * outside the viewport at the moment it is created — which made the branch
 * button look like it did nothing at all.
 */
describe('placing a new branch', () => {
  it('puts a first child level with its parent', () => {
    const root = starter.nodes.find((n) => n.id === 'n-root')!
    const childless = { ...starter, edges: [] }
    expect(placeChild(childless, 'n-root').y).toBe(root.position.y)
  })

  it('stacks each further sibling below the lowest one', () => {
    const lowest = Math.max(
      ...starter.edges
        .filter((e) => e.source === 'n-root')
        .map((e) => starter.nodes.find((n) => n.id === e.target)!.position.y),
    )
    expect(placeChild(starter, 'n-root').y).toBeGreaterThan(lowest + NODE_H)
  })

  it('puts every child to the right of its parent', () => {
    const root = starter.nodes.find((n) => n.id === 'n-root')!
    expect(placeChild(starter, 'n-root').x).toBeGreaterThan(root.position.x)
  })
})
