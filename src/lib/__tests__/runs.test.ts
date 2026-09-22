import { describe, expect, it } from 'vitest'
import type { Run } from '../../types'
import { DEFAULT_MODEL } from '../models'
import { isRunOpen, orderRunsNewestFirst, runPreview } from '../runs'

describe('run list', () => {
  const run = (id: string, over: Partial<Run> = {}): Run => ({
    id,
    status: 'done',
    text: `output ${id}`,
    model: DEFAULT_MODEL,
    ...over,
  })

  it('shows the newest run first', () => {
    const out = orderRunsNewestFirst([run('a'), run('b'), run('c')])
    expect(out.map((d) => d.run.id)).toEqual(['c', 'b', 'a'])
  })

  /*
   * Numbering follows creation, not screen position. Numbering top-down would
   * rename every earlier run each time a new one arrived, so "run 2" would mean
   * something different a minute later.
   */
  it('numbers runs by when they were created, not where they appear', () => {
    const out = orderRunsNewestFirst([run('a'), run('b'), run('c')])
    expect(out.map((d) => d.number)).toEqual([3, 2, 1])
    expect(out.find((d) => d.run.id === 'a')?.number).toBe(1)
  })

  it('opens the newest by default and leaves the rest closed', () => {
    expect(isRunOpen(run('a'), true, {})).toBe(true)
    expect(isRunOpen(run('a'), false, {})).toBe(false)
  })

  // Collapsing live output would hide the thing being waited for.
  it('always opens a run that is still producing tokens', () => {
    expect(isRunOpen(run('a', { status: 'streaming' }), false, {})).toBe(true)
    expect(isRunOpen(run('a', { status: 'loading' }), false, {})).toBe(true)
  })

  it('lets an explicit toggle win over every default', () => {
    expect(isRunOpen(run('a'), true, { a: false })).toBe(false)
    expect(isRunOpen(run('a', { status: 'streaming' }), false, { a: false })).toBe(false)
    expect(isRunOpen(run('a'), false, { a: true })).toBe(true)
  })

  it('previews a collapsed run on one line', () => {
    const preview = runPreview(run('a', { text: 'line one\nline two\n\nline three' }))
    expect(preview).toBe('line one line two line three')
    expect(preview).not.toContain('\n')
  })

  it('truncates a long preview and says so', () => {
    const preview = runPreview(run('a', { text: 'x'.repeat(500) }), 20)
    expect(preview).toHaveLength(21)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('describes a run with nothing to preview', () => {
    expect(runPreview(run('a', { text: '', status: 'done' }))).toBe('(empty response)')
    expect(runPreview(run('a', { text: '', status: 'streaming' }))).toBe('no output yet')
  })

  it('previews the error when a run failed', () => {
    expect(runPreview(run('a', { text: '', error: 'out of memory' }))).toBe('out of memory')
  })
})
