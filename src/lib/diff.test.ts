import { describe, expect, it } from 'vitest'
import {
  alignPhrases,
  alignRows,
  assemble,
  countChanges,
  segmentPhrases,
  similarity,
} from './diff'

describe('phrase diff and merge', () => {
  it('keeps list items whole rather than splitting them mid-bullet', () => {
    const segs = segmentPhrases('- first item. still the item\n- second item')
    expect(segs).toEqual(['- first item. still the item', '- second item'])
  })

  it('splits flowing prose on sentence boundaries', () => {
    expect(segmentPhrases('One thing. Two things! Three?')).toEqual([
      'One thing.',
      'Two things!',
      'Three?',
    ])
  })

  it('marks shared phrases as "both" and unique ones by side', () => {
    const p = alignPhrases('Keep this. Only in A.', 'Keep this. Only in B.')
    const both = p.filter((x) => x.side === 'both')
    expect(both).toHaveLength(1)
    expect(both[0].text).toBe('Keep this.')
    expect(p.some((x) => x.side === 'a' && x.text === 'Only in A.')).toBe(true)
    expect(p.some((x) => x.side === 'b' && x.text === 'Only in B.')).toBe(true)
  })

  it('assembles only the selected phrases, in order', () => {
    const p = alignPhrases('Alpha. Beta.', 'Alpha. Gamma.')
    const picked = new Set(p.filter((x) => x.side !== 'a').map((x) => x.id))
    expect(assemble(p, picked)).toBe('Alpha.\nGamma.')
  })

  it('scores identical text as fully similar and disjoint text as not', () => {
    expect(similarity('Same words here.', 'Same words here.')).toBe(1)
    expect(similarity('Totally different.', 'Nothing alike.')).toBeLessThan(0.2)
  })
})

describe('side-by-side diff rows', () => {
  it('pairs a reworded phrase into one row instead of a delete plus an insert', () => {
    const rows = alignRows('Be concise and clear.', 'Be terse and clear.')
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('changed')
    expect(rows[0].a).toBe('Be concise and clear.')
    expect(rows[0].b).toBe('Be terse and clear.')
  })

  it('shows each column only its own side markers', () => {
    const [row] = alignRows('Be concise.', 'Be terse.')
    // The A column must never render B's insertions, or it stops reading as prose.
    expect(row.aChunks?.some((c) => c.kind === 'added')).toBe(false)
    expect(row.bChunks?.some((c) => c.kind === 'removed')).toBe(false)
    expect(row.aChunks?.map((c) => c.value).join('')).toBe('Be concise.')
    expect(row.bChunks?.map((c) => c.value).join('')).toBe('Be terse.')
  })

  it('puts a pure addition on the B side only, with no A counterpart', () => {
    const rows = alignRows('Shared line.', `Shared line.
Brand new.`)
    expect(rows.map((r) => r.kind)).toEqual(['same', 'added'])
    expect(rows[1].a).toBeUndefined()
    expect(rows[1].b).toBe('Brand new.')
  })

  it('puts a pure removal on the A side only, with no B counterpart', () => {
    const rows = alignRows(`Shared line.
Going away.`, 'Shared line.')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'removed'])
    expect(rows[1].b).toBeUndefined()
    expect(rows[1].a).toBe('Going away.')
  })

  it('never loses a phrase, whatever the shape of the edit', () => {
    const cases: Array<[string, string]> = [
      ['', 'Only B.'],
      ['Only A.', ''],
      ['Same.', 'Same.'],
      ['A one. A two. A three.', 'B one.'],
      ['A one.', 'B one. B two. B three.'],
      ['Keep. Drop. Keep two.', 'Keep. Keep two.'],
    ]
    for (const [x, y] of cases) {
      const rows = alignRows(x, y)
      expect(rows.flatMap((r) => (r.a ? [r.a] : [])), `A side of ${JSON.stringify(x)}`).toEqual(
        segmentPhrases(x),
      )
      expect(rows.flatMap((r) => (r.b ? [r.b] : [])), `B side of ${JSON.stringify(y)}`).toEqual(
        segmentPhrases(y),
      )
    }
  })

  it('reports identical text as zero differences', () => {
    expect(countChanges(alignRows('Same words.', 'Same words.'))).toBe(0)
    expect(countChanges(alignRows('One.', 'Two.'))).toBe(1)
  })
})
