import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { buildStarterCanvas } from '../data/starterCanvas'
import { composePrompt } from '../lib/compose'
import {
  type LoadProgress,
  generate,
  loadModel,
  onLoadProgress,
  stopGeneration,
} from '../lib/engine'
import { formatError } from '../lib/errors'
import { layoutCanvas, placeChild } from '../lib/layout'
import { DEFAULT_MODEL, type ModelId } from '../lib/models'
import { saveCanvas } from '../lib/storage'
import type { Canvas, CanvasNode, ContextBlock, PromptNodeData, Run } from '../types'

interface CanvasState {
  canvas: Canvas
  selectedId: string | null
  /** Node ids pinned into the side-by-side comparison tray. */
  compare: string[]
  /** Null when no model download is in flight. */
  loading: LoadProgress | null
  /** Set once a model has finished loading in this session. */
  activeModel: ModelId | null
  running: number
  /** Non-fatal messages surfaced as a toast. */
  notice: { kind: 'info' | 'warn' | 'error'; text: string } | null

  setCanvas: (c: Canvas) => void
  select: (id: string | null) => void
  toggleCompare: (id: string) => void
  clearCompare: () => void
  setNotice: (n: CanvasState['notice']) => void

  updateNodeData: (id: string, patch: Partial<PromptNodeData>) => void
  moveNode: (id: string, position: { x: number; y: number }) => void
  addBranch: (parentId: string, correction?: string) => string
  addMergeNode: (aId: string, bId: string, mergedText: string, title?: string) => string
  deleteNode: (id: string) => void
  relayout: () => void
  resetToStarter: () => void
  newCanvas: () => void

  addBlock: (nodeId: string, block?: Partial<ContextBlock>) => void
  updateBlock: (nodeId: string, blockId: string, patch: Partial<ContextBlock>) => void
  removeBlock: (nodeId: string, blockId: string) => void

  ensureModel: (modelId: ModelId) => Promise<boolean>
  /** Clear the remembered model, e.g. after its weights are deleted. */
  setActiveModel: (modelId: ModelId | null) => void
  runNode: (nodeId: string, samples?: number) => Promise<void>
  runMany: (nodeIds: string[], samples?: number) => Promise<void>
  cancelNode: (nodeId: string) => void
  clearRuns: (nodeId: string) => void
}

function emptyCanvas(): Canvas {
  const rootId = `n-${nanoid(8)}`
  const now = Date.now()
  return {
    id: `c-${nanoid(8)}`,
    name: 'Untitled canvas',
    rootId,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: rootId,
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          title: 'Root prompt',
          system: '',
          instruction: '',
          blocks: [],
          model: DEFAULT_MODEL,
          // Small relative to a hosted API's ceiling, because generated tokens
          // count against the same 2048-token window as the prompt on SmolLM 135M.
          maxNewTokens: 256,
          runs: [],
        },
      },
    ],
    edges: [],
  }
}

export const useCanvas = create<CanvasState>((set, get) => {
  // Model download progress is pushed from the worker rather than polled.
  onLoadProgress((p) => set({ loading: p }))

  const persist = () => {
    void saveCanvas(get().canvas).catch(() => {
      /* storage is best-effort; export is the durable path */
    })
  }

  const patchNode = (id: string, fn: (n: CanvasNode) => CanvasNode) => {
    set({
      canvas: {
        ...get().canvas,
        nodes: get().canvas.nodes.map((n) => (n.id === id ? fn(n) : n)),
        updatedAt: Date.now(),
      },
    })
  }

  const patchRun = (nodeId: string, runId: string, patch: Partial<Run>) => {
    patchNode(nodeId, (n) => ({
      ...n,
      data: { ...n.data, runs: n.data.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)) },
    }))
  }

  return {
    canvas: layoutCanvas(buildStarterCanvas()),
    selectedId: 'n-root',
    compare: [],
    loading: null,
    activeModel: null,
    running: 0,
    notice: null,

    setCanvas: (c) => {
      set({ canvas: c, selectedId: c.rootId, compare: [] })
      persist()
    },
    select: (id) => set({ selectedId: id }),
    toggleCompare: (id) => {
      const cur = get().compare
      set({ compare: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
    },
    clearCompare: () => set({ compare: [] }),
    setNotice: (n) => set({ notice: n }),

    updateNodeData: (id, patch) => {
      patchNode(id, (n) => ({ ...n, data: { ...n.data, ...patch } }))
      persist()
    },

    moveNode: (id, position) => patchNode(id, (n) => ({ ...n, position })),

    addBranch: (parentId, correction) => {
      const canvas = get().canvas
      const parent = canvas.nodes.find((n) => n.id === parentId)
      if (!parent) return parentId
      const id = `n-${nanoid(8)}`
      const node: CanvasNode = {
        id,
        type: 'prompt',
        position: placeChild(canvas, parentId),
        data: {
          title: 'New branch',
          blocks: [
            {
              id: `b-${nanoid(6)}`,
              label: 'correction',
              kind: 'correction',
              enabled: true,
              text: correction ?? '',
            },
          ],
          model: parent.data.model,
          maxNewTokens: parent.data.maxNewTokens,
          runs: [],
        },
      }
      set({
        canvas: {
          ...canvas,
          nodes: [...canvas.nodes, node],
          edges: [
            ...canvas.edges,
            { id: `e-${nanoid(6)}`, source: parentId, target: id, kind: 'branch' },
          ],
          updatedAt: Date.now(),
        },
        selectedId: id,
      })
      persist()
      return id
    },

    /**
     * A merge produces a *new* node with two incoming edges rather than
     * re-parenting anything. The canvas is a DAG; the two source branches keep
     * their history intact and the provenance stays visible.
     */
    addMergeNode: (aId, bId, mergedText, title) => {
      const canvas = get().canvas
      const a = canvas.nodes.find((n) => n.id === aId)
      const b = canvas.nodes.find((n) => n.id === bId)
      if (!a || !b) return aId
      const id = `n-${nanoid(8)}`
      const node: CanvasNode = {
        id,
        type: 'merge',
        position: {
          x: Math.max(a.position.x, b.position.x) + 390,
          y: (a.position.y + b.position.y) / 2,
        },
        data: {
          title: title ?? `Merged: ${a.data.title} + ${b.data.title}`,
          mergedFrom: [aId, bId],
          blocks: [
            {
              id: `b-${nanoid(6)}`,
              label: 'merged correction',
              kind: 'correction',
              enabled: true,
              text: mergedText,
            },
          ],
          model: a.data.model,
          maxNewTokens: a.data.maxNewTokens,
          runs: [],
        },
      }
      set({
        canvas: {
          ...canvas,
          nodes: [...canvas.nodes, node],
          edges: [
            ...canvas.edges,
            { id: `e-${nanoid(6)}`, source: aId, target: id, kind: 'merge' },
            { id: `e-${nanoid(6)}`, source: bId, target: id, kind: 'merge' },
          ],
          updatedAt: Date.now(),
        },
        selectedId: id,
      })
      persist()
      return id
    },

    deleteNode: (id) => {
      const canvas = get().canvas
      if (id === canvas.rootId) {
        set({ notice: { kind: 'warn', text: 'The root prompt cannot be deleted.' } })
        return
      }
      // Only the node itself goes; orphaned children are re-pointed at its
      // parents so deleting a middle node does not silently destroy a subtree.
      const parents = canvas.edges.filter((e) => e.target === id).map((e) => e.source)
      const children = canvas.edges.filter((e) => e.source === id).map((e) => e.target)
      const kept = canvas.edges.filter((e) => e.source !== id && e.target !== id)
      const bridged = parents.flatMap((p) =>
        children.map((c) => ({
          id: `e-${nanoid(6)}`,
          source: p,
          target: c,
          kind: 'branch' as const,
        })),
      )
      set({
        canvas: {
          ...canvas,
          nodes: canvas.nodes.filter((n) => n.id !== id),
          edges: [...kept, ...bridged],
          updatedAt: Date.now(),
        },
        selectedId: parents[0] ?? canvas.rootId,
        compare: get().compare.filter((c) => c !== id),
      })
      persist()
    },

    relayout: () => {
      set({ canvas: layoutCanvas(get().canvas) })
      persist()
    },

    resetToStarter: () => {
      set({ canvas: layoutCanvas(buildStarterCanvas()), selectedId: 'n-root', compare: [] })
    },

    newCanvas: () => {
      const c = emptyCanvas()
      set({ canvas: c, selectedId: c.rootId, compare: [] })
      persist()
    },

    addBlock: (nodeId, block) => {
      patchNode(nodeId, (n) => ({
        ...n,
        data: {
          ...n.data,
          blocks: [
            ...n.data.blocks,
            {
              id: `b-${nanoid(6)}`,
              label: block?.label ?? 'context',
              kind: block?.kind ?? 'context',
              enabled: block?.enabled ?? true,
              text: block?.text ?? '',
            },
          ],
        },
      }))
      persist()
    },

    updateBlock: (nodeId, blockId, patch) => {
      patchNode(nodeId, (n) => ({
        ...n,
        data: {
          ...n.data,
          blocks: n.data.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
        },
      }))
      persist()
    },

    removeBlock: (nodeId, blockId) => {
      patchNode(nodeId, (n) => ({
        ...n,
        data: { ...n.data, blocks: n.data.blocks.filter((b) => b.id !== blockId) },
      }))
      persist()
    },

    clearRuns: (nodeId) => {
      patchNode(nodeId, (n) => ({ ...n, data: { ...n.data, runs: [] } }))
      persist()
    },

    cancelNode: () => {
      // One model, one worker: there is only ever one generation to interrupt.
      stopGeneration()
    },

    setActiveModel: (modelId) => set({ activeModel: modelId }),

    /** Download and initialise a model, reporting failure as a notice. */
    ensureModel: async (modelId) => {
      try {
        await loadModel(modelId)
        set({ activeModel: modelId, loading: null })
        return true
      } catch (err) {
        set({ loading: null, notice: { kind: 'error', text: formatError(err) } })
        return false
      }
    },

    runNode: async (nodeId, samples = 1) => {
      const canvas = get().canvas
      const node = canvas.nodes.find((n) => n.id === nodeId)
      if (!node) return

      const prompt = composePrompt(canvas, nodeId)

      const newRuns: Run[] = Array.from({ length: samples }, () => ({
        id: `r-${nanoid(8)}`,
        status: 'loading' as const,
        text: '',
        model: node.data.model,
        startedAt: Date.now(),
      }))

      patchNode(nodeId, (n) => ({ ...n, data: { ...n.data, runs: [...n.data.runs, ...newRuns] } }))

      // Runs are queued inside the engine, so this loop is sequential by design.
      for (const run of newRuns) {
        set({ running: get().running + 1 })
        let text = ''
        try {
          const stats = await generate(
            run.id,
            node.data.model,
            prompt,
            node.data.maxNewTokens,
            {
              onStart: () => patchRun(nodeId, run.id, { status: 'streaming' }),
              onText: (d) => {
                text += d
                patchRun(nodeId, run.id, { text })
              },
            },
          )
          patchRun(nodeId, run.id, {
            status: 'done',
            text,
            stats,
            finishedAt: Date.now(),
          })
          set({ activeModel: node.data.model })
        } catch (err) {
          // An interrupt surfaces as a rejection, but the partial text is real
          // output and worth keeping rather than discarding.
          const cancelled = /abort|interrupt|cancel/i.test(
            err instanceof Error ? err.message : String(err),
          )
          patchRun(nodeId, run.id, {
            status: cancelled ? 'cancelled' : 'error',
            text,
            error: cancelled ? undefined : formatError(err),
            finishedAt: Date.now(),
          })
          if (!cancelled) set({ notice: { kind: 'error', text: formatError(err) } })
        } finally {
          set({ running: Math.max(0, get().running - 1) })
          persist()
        }
      }
    },

    runMany: async (nodeIds, samples = 1) => {
      for (const id of nodeIds) await get().runNode(id, samples)
    },
  }
})
