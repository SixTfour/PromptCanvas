import { describe, expect, it } from 'vitest'
import { starter, withMerge } from '../../test/fixtures'
import { ancestorChain, composePrompt, parentsOf } from '../compose'

describe('DAG traversal', () => {
  it('walks a plain branch root-first', () => {
    expect(ancestorChain(starter, 'n-terse')).toEqual(['n-root', 'n-terse'])
  })

  it('reaches a merge node through both parents without duplicating the root', () => {
    const chain = ancestorChain(withMerge, 'n-merged')
    expect(chain).toContain('n-root')
    expect(chain).toContain('n-terse')
    expect(chain).toContain('n-severity')
    // The shared ancestor must appear exactly once, or its context is sent twice.
    expect(chain.filter((id) => id === 'n-root')).toHaveLength(1)
    // Every node must come after all of its own ancestors.
    expect(chain.indexOf('n-root')).toBeLessThan(chain.indexOf('n-terse'))
    expect(chain.indexOf('n-terse')).toBeLessThan(chain.indexOf('n-merged'))
  })

  it('reports both parents of a merge node', () => {
    expect(parentsOf(withMerge, 'n-merged').sort()).toEqual(['n-severity', 'n-terse'])
  })

  it('does not hang on a cycle', () => {
    const cyclic = {
      ...withMerge,
      edges: [
        ...withMerge.edges,
        { id: 'bad', source: 'n-merged', target: 'n-root', kind: 'branch' as const },
      ],
    }
    expect(() => ancestorChain(cyclic, 'n-merged')).not.toThrow()
  })
})

describe('prompt composition', () => {
  it('inherits the root system prompt and instruction down a branch', () => {
    const c = composePrompt(starter, 'n-terse')
    expect(c.system).toContain('engineering triage assistant')
    expect(c.instruction).toBe('Turn the bug report into a triaged engineering ticket.')
  })

  it('marks inherited blocks and includes the branch own block last', () => {
    const c = composePrompt(starter, 'n-terse')
    expect(c.blocks[0].inherited).toBe(true)
    expect(c.blocks.at(-1)?.inherited).toBe(false)
    expect(c.blocks.at(-1)?.kind).toBe('correction')
  })

  it('counts the leading blocks a node shares with its siblings', () => {
    const c = composePrompt(starter, 'n-terse')
    // One inherited block (the bug report) is shared with the sibling branch.
    expect(c.sharedPrefixLength).toBe(1)
    expect(c.blocks.slice(0, c.sharedPrefixLength).every((b) => b.inherited)).toBe(true)
  })

  it('gives two siblings an identical shared prefix', () => {
    const a = composePrompt(starter, 'n-terse')
    const b = composePrompt(starter, 'n-severity')
    const prefixA = a.blocks.slice(0, a.sharedPrefixLength).map((x) => x.text)
    const prefixB = b.blocks.slice(0, b.sharedPrefixLength).map((x) => x.text)
    expect(prefixA).toEqual(prefixB)
  })

  it('excludes disabled blocks from the composed text', () => {
    const off = {
      ...starter,
      nodes: starter.nodes.map((n) =>
        n.id === 'n-root'
          ? { ...n, data: { ...n.data, blocks: n.data.blocks.map((b) => ({ ...b, enabled: false })) } }
          : n,
      ),
    }
    expect(composePrompt(off, 'n-terse').text).not.toContain('NW-88213')
  })
})
