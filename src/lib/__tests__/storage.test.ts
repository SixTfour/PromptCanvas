import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL,
  contextPressure,
  dtypeCandidates,
  effectiveMaxNewTokens,
  isKnownModel,
  modelMaxNewTokens,
} from '../models'
import { staleMergeSources } from '../merge'
import { migrateCanvas, shortSessionId } from '../storage'

describe('session id display', () => {
  it('leaves a normally generated id alone', () => {
    expect(shortSessionId('c-Ab3dEf9x')).toBe('c-Ab3dEf9x')
  })

  it('truncates an over-long id from an imported canvas', () => {
    const long = 'canvas-from-somewhere-else-0123456789'
    const out = shortSessionId(long)
    expect(out.length).toBeLessThanOrEqual(14)
    expect(out).toContain('…')
  })

  // Two ids that share a prefix are exactly the case this has to survive, so
  // the tail has to be kept rather than trimmed away.
  it('keeps both ends, so ids sharing a prefix stay distinguishable', () => {
    const a = shortSessionId('session-prefix-aaaaaaaa')
    const b = shortSessionId('session-prefix-bbbbbbbb')
    expect(a).not.toBe(b)
  })

  it('handles empty and boundary lengths without throwing', () => {
    expect(shortSessionId('')).toBe('')
    expect(shortSessionId('12345678901234')).toBe('12345678901234')
    expect(shortSessionId('123456789012345').length).toBeLessThanOrEqual(14)
  })
})

describe('migrating older canvases', () => {
  const nodeWith = (maxNewTokens: unknown) => ({
    id: 'n1',
    type: 'prompt' as const,
    position: { x: 0, y: 0 },
    data: {
      title: 'n',
      blocks: [],
      model: DEFAULT_MODEL,
      maxNewTokens,
      runs: [],
    },
  })
  const canvasWith = (maxNewTokens: unknown) =>
    ({
      id: 'c',
      name: 'c',
      rootId: 'n1',
      createdAt: 0,
      updatedAt: 0,
      nodes: [nodeWith(maxNewTokens)],
      edges: [],
    }) as unknown as Parameters<typeof migrateCanvas>[0]

  // 256 was the hardcoded default before length was derived from the prompt,
  // so nobody chose it and old sessions should behave like new ones.
  it('turns the old default into auto', () => {
    expect(migrateCanvas(canvasWith(256)).nodes[0].data.maxNewTokens).toBe('auto')
  })

  it('leaves a deliberately chosen number alone', () => {
    expect(migrateCanvas(canvasWith(512)).nodes[0].data.maxNewTokens).toBe(512)
    expect(migrateCanvas(canvasWith(128)).nodes[0].data.maxNewTokens).toBe(128)
  })

  it('leaves an already-migrated canvas untouched', () => {
    const c = canvasWith('auto')
    expect(migrateCanvas(c)).toBe(c)
  })
})

describe('canvases that outlived their model registry', () => {
  const canvasWithModel = (model: unknown) =>
    ({
      id: 'c',
      name: 'c',
      rootId: 'n1',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        {
          id: 'n1',
          type: 'prompt' as const,
          position: { x: 0, y: 0 },
          data: { title: 'n', blocks: [], model, maxNewTokens: 'auto', runs: [] },
        },
      ],
      edges: [],
    }) as unknown as Parameters<typeof migrateCanvas>[0]

  /*
   * This app ran against a hosted API before it ran locally, and those
   * canvases are still in IndexedDB. An unknown id used to index into
   * undefined the moment anything asked for the model's context window,
   * which took the inspector down on load.
   */
  it('repoints a model that no longer ships at the default', () => {
    const out = migrateCanvas(canvasWithModel('claude-opus-5'))
    expect(out.nodes[0].data.model).toBe(DEFAULT_MODEL)
  })

  it('leaves a model that still ships alone', () => {
    const out = migrateCanvas(canvasWithModel('HuggingFaceTB/SmolLM2-1.7B-Instruct'))
    expect(out.nodes[0].data.model).toBe('HuggingFaceTB/SmolLM2-1.7B-Instruct')
  })

  it('handles a node with no model at all', () => {
    expect(migrateCanvas(canvasWithModel(undefined)).nodes[0].data.model).toBe(DEFAULT_MODEL)
  })
})

/*
 * Blocks could once be an `example`, which rendered under its own heading and
 * otherwise behaved exactly like `context`. The kind was dropped rather than
 * kept as a control with no effect, so saved canvases still carrying it have
 * to land somewhere: an unmapped kind composes to `## undefined`.
 */
describe('canvases holding a block kind that no longer exists', () => {
  const canvasWithKinds = (...kinds: string[]) =>
    ({
      id: 'c',
      name: 'c',
      rootId: 'n1',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: {
            title: 'n',
            blocks: kinds.map((kind, i) => ({
              id: `b${i}`,
              kind,
              label: '',
              text: 't',
              enabled: true,
            })),
            model: DEFAULT_MODEL,
            maxNewTokens: 'auto' as const,
            runs: [],
          },
        },
      ],
      edges: [],
    }) as unknown as Parameters<typeof migrateCanvas>[0]

  it('turns an example block into context', () => {
    const out = migrateCanvas(canvasWithKinds('example'))
    expect(out.nodes[0].data.blocks[0].kind).toBe('context')
  })

  it('keeps the heading the block used to render under', () => {
    // Silently relabelling it Context would change the prompt the user wrote.
    expect(migrateCanvas(canvasWithKinds('example')).nodes[0].data.blocks[0].label).toBe('Example')
  })

  it('leaves the kinds that still exist alone', () => {
    const out = migrateCanvas(canvasWithKinds('context', 'correction'))
    expect(out.nodes[0].data.blocks.map((b) => b.kind)).toEqual(['context', 'correction'])
  })

  it('does not rewrite a canvas that needs nothing', () => {
    const c = canvasWithKinds('context', 'correction')
    expect(migrateCanvas(c)).toBe(c)
  })
})

describe('registry lookups survive a stale id', () => {
  const stale = 'claude-opus-5' as never

  it('falls back instead of throwing on an unknown model', () => {
    expect(() => contextPressure(stale, 100, 100)).not.toThrow()
    expect(contextPressure(stale, 100, 100).limit).toBeGreaterThan(0)
    expect(effectiveMaxNewTokens(stale, 100, 'auto')).toBeGreaterThan(0)
    expect(modelMaxNewTokens(stale)).toBeGreaterThan(0)
    expect(dtypeCandidates(stale, 'webgpu', true).length).toBeGreaterThan(0)
  })

  it('knows which ids are real', () => {
    expect(isKnownModel(DEFAULT_MODEL)).toBe(true)
    expect(isKnownModel('claude-opus-5')).toBe(false)
    expect(isKnownModel(undefined)).toBe(false)
  })
})

/*
 * A merge records what it was built from so later edits to a branch can be
 * flagged. Canvases made before that bookkeeping have no basis, and without a
 * backfill they would never flag anything again.
 */
describe('merges that predate their own bookkeeping', () => {
  const merged = () =>
    ({
      id: 'c',
      name: 'c',
      rootId: 'n1',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: {
            title: 'branch',
            blocks: [
              { id: 'b1', kind: 'correction', label: '', text: 'original', enabled: true },
            ],
            model: DEFAULT_MODEL,
            maxNewTokens: 'auto' as const,
            runs: [],
          },
        },
        {
          id: 'n2',
          position: { x: 0, y: 0 },
          data: {
            title: 'merged',
            mergedFrom: ['n1', 'n1'],
            blocks: [{ id: 'b2', kind: 'correction', label: '', text: 'merged', enabled: true }],
            model: DEFAULT_MODEL,
            maxNewTokens: 'auto' as const,
            runs: [],
          },
        },
      ],
      edges: [{ id: 'e', source: 'n1', target: 'n2', kind: 'merge' }],
    }) as unknown as Parameters<typeof migrateCanvas>[0]

  it('records a basis so future drift is detectable', () => {
    const out = migrateCanvas(merged())
    expect(out.nodes[1].data.mergeBasis).toBeTruthy()
  })

  it('treats the branches as current at the moment of the backfill', () => {
    // A guess, and the comment on migrateCanvas says so: a merge that was
    // already stale is recorded as fresh. Flagging every old merge instead
    // would be equally untrue and far noisier.
    const out = migrateCanvas(merged())
    expect(staleMergeSources(out, 'n2')).toEqual([])
  })

  it('flags the branch once it changes after the backfill', () => {
    const out = migrateCanvas(merged())
    const edited = {
      ...out,
      nodes: out.nodes.map((n) =>
        n.id === 'n1'
          ? { ...n, data: { ...n.data, blocks: [{ ...n.data.blocks[0], text: 'changed' }] } }
          : n,
      ),
    }
    expect(staleMergeSources(edited, 'n2')).toContain('n1')
  })

  it('leaves a merge that already has a basis alone', () => {
    const once = migrateCanvas(merged())
    expect(migrateCanvas(once)).toBe(once)
  })
})
