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

describe('a branch amends what came before it', () => {
  const order = (text: string) => text.match(/^## .+$/gm) ?? []

  /*
   * A correction only means something after the thing it corrects. The task
   * used to be appended last regardless of which node declared it, which put
   * every inherited correction in the middle of the prompt.
   */
  it('puts a child block after the task it inherits', () => {
    const headings = order(composePrompt(starter, 'n-terse').text)
    expect(headings).toEqual(['## Bug report', '## Task', '## correction: scannable'])
  })

  it('leaves the root reading as a plain prompt', () => {
    expect(order(composePrompt(starter, 'n-root').text)).toEqual(['## Bug report', '## Task'])
  })

  it('keeps a node that overrides the task in charge of where it lands', () => {
    const overriding = {
      ...starter,
      nodes: starter.nodes.map((n) =>
        n.id === 'n-terse' ? { ...n, data: { ...n.data, instruction: 'Do it differently.' } } : n,
      ),
    }
    const headings = order(composePrompt(overriding, 'n-terse').text)
    // Its own task replaces the inherited one and follows its own blocks.
    expect(headings).toEqual(['## Bug report', '## correction: scannable', '## Task'])
    expect(composePrompt(overriding, 'n-terse').text).toContain('Do it differently.')
  })

  it('uses the block label as the heading the model reads', () => {
    const renamed = {
      ...starter,
      nodes: starter.nodes.map((n) =>
        n.id === 'n-root'
          ? {
              ...n,
              data: {
                ...n.data,
                blocks: n.data.blocks.map((b) => ({ ...b, label: 'Customer email' })),
              },
            }
          : n,
      ),
    }
    expect(composePrompt(renamed, 'n-root').text).toContain('## Customer email')
    expect(composePrompt(renamed, 'n-root').text).not.toContain('## Bug report')
  })
})

/*
 * A correction the model treats as prose is not a correction. Measured on
 * SmolLM2 1.7B: under a bare heading it narrated around the constraint and
 * ignored it; told plainly that it overrides, it complied. So the kind has to
 * survive into the prompt text, not just sit in the data model.
 */
describe('a correction says that it overrides', () => {
  const OVERRIDE = /overriding anything above that conflicts/

  const withBlock = (kind: 'context' | 'correction') => ({
    ...starter,
    nodes: starter.nodes.map((n) =>
      n.id === 'n-root'
        ? {
            ...n,
            data: {
              ...n.data,
              blocks: [
                {
                  id: 'b-1',
                  kind,
                  label: 'Note',
                  text: 'Fly out of Colorado Springs.',
                  enabled: true,
                },
              ],
            },
          }
        : n,
    ),
  })

  it('leads a correction block with the instruction to override', () => {
    const text = composePrompt(withBlock('correction'), 'n-root').text
    expect(text).toMatch(OVERRIDE)
    // The heading the user chose still stands; only the body gains the lead-in.
    expect(text).toContain('## Note')
    expect(text).toContain('Fly out of Colorado Springs.')
  })

  it('leaves a context block alone', () => {
    expect(composePrompt(withBlock('context'), 'n-root').text).not.toMatch(OVERRIDE)
  })

  it('falls back to a heading that names the kind', () => {
    const unnamed = (kind: 'context' | 'correction') => {
      const c = withBlock(kind)
      return composePrompt(
        {
          ...c,
          nodes: c.nodes.map((n) =>
            n.id === 'n-root'
              ? { ...n, data: { ...n.data, blocks: n.data.blocks.map((b) => ({ ...b, label: '' })) } }
              : n,
          ),
        },
        'n-root',
      ).text
    }
    // An unnamed block still has to render as something the model can read.
    expect(unnamed('context')).toContain('## Context')
    expect(unnamed('correction')).toContain('## Correction')
  })

  it('does not double the lead-in when the block is inherited', () => {
    const text = composePrompt(withBlock('correction'), 'n-terse').text
    expect(text.match(OVERRIDE)).toHaveLength(1)
  })
})

/*
 * Diff & Merge synthesises its text from the two source nodes' own blocks. If
 * those blocks are also inherited through the chain, the merged prompt carries
 * both branches' corrections *and* the reconciliation of them — which is the
 * disagreement the merge was created to settle, handed back to the model.
 */
describe('a merge replaces what it merged', () => {
  const headings = (text: string) => text.match(/^## .+$/gm) ?? []

  it("drops the source nodes' blocks in favour of the merged one", () => {
    const text = composePrompt(withMerge, 'n-merged').text
    expect(text).toContain('Do both.')
    expect(headings(text)).toEqual(['## Bug report', '## Task', '## merged'])
  })

  it('keeps everything above the fork', () => {
    const root = starter.nodes.find((n) => n.id === 'n-root')!
    const inheritedText = root.data.blocks[0].text
    // The merge never saw the trunk, so it cannot have folded it in.
    expect(composePrompt(withMerge, 'n-merged').text).toContain(inheritedText)
  })

  it('marks the source blocks as no longer inherited', () => {
    const { blocks } = composePrompt(withMerge, 'n-merged')
    expect(blocks.map((b) => b.fromNodeId)).toEqual(['n-root', 'n-merged'])
  })

  it('leaves the source branches themselves untouched', () => {
    // Superseding applies to the merge's prompt, not to the branches, which
    // must stay runnable and comparable on their own.
    expect(headings(composePrompt(withMerge, 'n-terse').text)).toEqual([
      '## Bug report',
      '## Task',
      '## correction: scannable',
    ])
  })

  it('supersedes nothing when the merged block is emptied', () => {
    const emptied = {
      ...withMerge,
      nodes: withMerge.nodes.map((n) =>
        n.id === 'n-merged' ? { ...n, data: { ...n.data, blocks: [] } } : n,
      ),
    }
    // Otherwise deleting the merged block would silently delete both branches.
    const text = composePrompt(emptied, 'n-merged').text
    expect(text).toContain('correction: scannable')
    expect(text).toContain('correction: severity')
  })
})
