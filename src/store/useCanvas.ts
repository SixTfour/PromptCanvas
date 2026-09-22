import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { buildStarterCanvas } from '../data/starterCanvas'
import { composePrompt } from '../lib/compose'
import {
  type LoadProgress,
  cacheUsage,
  currentDevice,
  currentDtype,
  generate,
  loadModel,
  onLoadProgress,
  stopGeneration,
} from '../lib/engine'
import { formatError } from '../lib/errors'
import { layoutCanvas, placeChild } from '../lib/layout'
import { DEFAULT_MODEL, type ModelId } from '../lib/models'
import { sessionIdFromSearch, withSessionParam } from '../lib/url'
import {
  type CanvasSummary,
  deleteCanvas,
  duplicateCanvas,
  getLastCanvasId,
  listCanvases,
  loadCanvas,
  rememberLastCanvas,
  saveCanvas,
} from '../lib/storage'
import type { Canvas, CanvasNode, ContextBlock, PromptNodeData, Run } from '../types'

/**
 * Put the session in the address bar.
 *
 * `push` for a switch the user asked for, so Back returns to where they were;
 * `replace` for everything else, since restoring a session on load or creating
 * one should not leave a history entry that goes nowhere useful.
 */
function syncUrl(id: string, mode: 'push' | 'replace') {
  try {
    const next = withSessionParam(window.location.href, id)
    if (next === window.location.href) return
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', next)
  } catch {
    /* an unwritable address bar is not worth failing over */
  }
}

const LS_SESSIONS_OPEN = 'promptcanvas.sessionsOpen'

/** Open by default, so the rail is discovered rather than hunted for. */
function readSessionsOpen(): boolean {
  try {
    return localStorage.getItem(LS_SESSIONS_OPEN) !== '0'
  } catch {
    return true
  }
}

/** How many steps back you can go before the oldest is dropped. */
const HISTORY_LIMIT = 60

/** Edits closer together than this, with the same key, collapse into one step. */
const COALESCE_MS = 700

/**
 * Restore a remembered canvas without throwing away generated text.
 *
 * Runs are expensive and are not really part of the edit you are undoing, so a
 * node that still exists keeps whatever it has generated since. A node being
 * brought back from a delete gets its own runs back, because those went away
 * with it.
 */
function restoreCanvas(historical: Canvas, current: Canvas): Canvas {
  const liveRuns = new Map(current.nodes.map((n) => [n.id, n.data.runs]))
  return {
    ...historical,
    nodes: historical.nodes.map((n) => {
      const existing = liveRuns.get(n.id)
      return existing ? { ...n, data: { ...n.data, runs: existing } } : n
    }),
    updatedAt: Date.now(),
  }
}

interface CanvasState {
  canvas: Canvas
  /** Snapshots behind and ahead of the current canvas. */
  past: Canvas[]
  future: Canvas[]
  selectedId: string | null
  /** Node ids pinned into the side-by-side comparison tray. */
  compare: string[]
  /** Null when no model download is in flight. */
  loading: LoadProgress | null
  /** Set once a model has finished loading in this session. */
  activeModel: ModelId | null
  running: number
  /** Whether the sessions rail is expanded. Remembered across visits. */
  sessionsOpen: boolean
  /** Non-fatal messages surfaced as a toast. */
  notice: { kind: 'info' | 'warn' | 'error'; text: string } | null

  setCanvas: (c: Canvas) => void
  undo: () => void
  redo: () => void

  /** Reopen the last session on startup. Safe to call once, on mount. */
  hydrate: () => Promise<void>
  listSessions: () => Promise<CanvasSummary[]>
  openSession: (id: string, opts?: { fromHistory?: boolean }) => Promise<void>
  /** Follow the session named by the current URL, for back/forward. */
  syncFromUrl: () => Promise<void>
  duplicateSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  renameSession: (name: string) => void
  setSessionsOpen: (open: boolean) => void
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
          // Use whatever the prompt leaves free; an explicit number is an
          // Advanced Settings decision, not a starting condition.
          maxNewTokens: 'auto',
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

  /**
   * Remember the canvas before an edit changes it.
   *
   * `coalesceKey` collapses a run of related edits into one step: typing into a
   * prompt should be one undo, not one per keystroke, and dragging a node
   * should be one undo, not one per frame.
   */
  let lastCoalesce: { key: string; at: number } | null = null

  const pushHistory = (coalesceKey?: string) => {
    const now = Date.now()
    if (
      coalesceKey &&
      lastCoalesce &&
      lastCoalesce.key === coalesceKey &&
      now - lastCoalesce.at < COALESCE_MS
    ) {
      lastCoalesce.at = now
      return
    }
    lastCoalesce = coalesceKey ? { key: coalesceKey, at: now } : null

    const past = [...get().past, get().canvas].slice(-HISTORY_LIMIT)
    // Any new edit invalidates the redo branch, as in every other editor.
    set({ past, future: [] })
  }

  let hydrated = false

  const persist = () => {
    const c = get().canvas
    rememberLastCanvas(c.id)
    void saveCanvas(c).catch(() => {
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
    past: [],
    future: [],
    selectedId: 'n-root',
    compare: [],
    loading: null,
    sessionsOpen: readSessionsOpen(),
    activeModel: null,
    running: 0,
    notice: null,

    setCanvas: (c) => {
      pushHistory()
      set({ canvas: c, selectedId: c.rootId, compare: [] })
      persist()
    },

    /**
     * Restore the session the user was last in.
     *
     * Runs once and only while the canvas is still untouched: replacing what
     * someone has already started editing would be worse than losing the
     * restore. History is not recorded, since the restore is not an edit.
     */
    hydrate: async () => {
      if (hydrated) return
      hydrated = true
      try {
        // A link wins over "wherever I was last": following it is the reason
        // the tab was opened.
        const linked = sessionIdFromSearch(window.location.search)
        const id = linked ?? getLastCanvasId()

        if (linked) {
          const saved = await loadCanvas(linked)
          if (!saved) {
            // Worth saying out loud: the id is real, it is just not in this
            // browser, which is not obvious from a URL that looks shareable.
            set({
              notice: {
                kind: 'warn',
                text: 'That session link does not match anything saved in this browser. Session links only open on the machine that created them.',
              },
            })
            syncUrl(get().canvas.id, 'replace')
            return
          }
          if (get().past.length === 0) {
            rememberLastCanvas(saved.id)
            set({ canvas: saved, selectedId: saved.rootId, compare: [] })
          }
          return
        }

        if (id && id !== get().canvas.id) {
          const saved = await loadCanvas(id)
          if (saved && get().past.length === 0) {
            set({ canvas: saved, selectedId: saved.rootId, compare: [] })
          }
        }
      } catch {
        // A failed restore just means starting fresh, which is not worth a notice.
      } finally {
        // Whatever ended up open, the address bar should name it.
        syncUrl(get().canvas.id, 'replace')
        // Save it if it is not already a record. The sidebar lists the open
        // canvas whether or not it has been saved, so without this a first
        // visit shows a session that does not yet exist on disk — which then
        // looks like a duplicate the moment a real one is restored.
        void loadCanvas(get().canvas.id).then((existing) => {
          if (!existing) persist()
        })
      }
    },

    syncFromUrl: async () => {
      const id = sessionIdFromSearch(window.location.search)
      if (!id || id === get().canvas.id) return
      await get().openSession(id, { fromHistory: true })
    },

    listSessions: () => listCanvases(),

    setSessionsOpen: (open) => {
      try {
        localStorage.setItem(LS_SESSIONS_OPEN, open ? '1' : '0')
      } catch {
        /* a remembered panel state is not worth failing over */
      }
      set({ sessionsOpen: open })
    },

    openSession: async (id, opts) => {
      const saved = await loadCanvas(id)
      if (!saved) {
        set({ notice: { kind: 'error', text: 'That session could not be loaded.' } })
        return
      }
      // Save whatever is open before switching away from it.
      await saveCanvas(get().canvas).catch(() => undefined)
      rememberLastCanvas(id)
      set({ canvas: saved, selectedId: saved.rootId, compare: [], past: [], future: [] })
      // Arriving via Back already has the right URL; pushing again would trap
      // the user in their own history.
      syncUrl(id, opts?.fromHistory ? 'replace' : 'push')
    },

    duplicateSession: async (id) => {
      const copy = await duplicateCanvas(id, `c-${nanoid(8)}`)
      if (copy) set({ notice: { kind: 'info', text: `Duplicated as "${copy.name}".` } })
    },

    /**
     * Delete a session, and leave the user somewhere real.
     *
     * Deleting the *open* session used to mint a brand new starter canvas and
     * save it on the spot, which meant the delete appeared to do nothing: one
     * record went, another immediately took its place, and the count never
     * moved. Falling back to the most recent surviving session is what a
     * person expects, and a fresh canvas is only created when there is
     * genuinely nothing left to fall back to.
     */
    deleteSession: async (id) => {
      await deleteCanvas(id)
      if (id !== get().canvas.id) return

      const remaining = (await listCanvases()).filter((c) => c.id !== id)
      const next = remaining[0] ? await loadCanvas(remaining[0].id) : undefined

      if (next) {
        rememberLastCanvas(next.id)
        set({ canvas: next, selectedId: next.rootId, compare: [], past: [], future: [] })
        syncUrl(next.id, 'replace')
        return
      }

      const c = layoutCanvas(buildStarterCanvas())
      set({ canvas: c, selectedId: c.rootId, compare: [], past: [], future: [] })
      syncUrl(c.id, 'replace')
      persist()
    },

    renameSession: (name) => {
      pushHistory('rename')
      set({ canvas: { ...get().canvas, name, updatedAt: Date.now() } })
      persist()
    },

    undo: () => {
      const { past, canvas, future } = get()
      const previous = past.at(-1)
      if (!previous) return
      lastCoalesce = null
      set({
        past: past.slice(0, -1),
        canvas: restoreCanvas(previous, canvas),
        future: [canvas, ...future].slice(0, HISTORY_LIMIT),
      })
      persist()
    },

    redo: () => {
      const { past, canvas, future } = get()
      const next = future[0]
      if (!next) return
      lastCoalesce = null
      set({
        past: [...past, canvas].slice(-HISTORY_LIMIT),
        canvas: restoreCanvas(next, canvas),
        future: future.slice(1),
      })
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
      // Keyed by field so switching from the title to the model is a new step.
      pushHistory(`data:${id}:${Object.keys(patch).join(',')}`)
      patchNode(id, (n) => ({ ...n, data: { ...n.data, ...patch } }))
      persist()
    },

    moveNode: (id, position) => {
      pushHistory(`move:${id}`)
      patchNode(id, (n) => ({ ...n, position }))
    },

    addBranch: (parentId, correction) => {
      pushHistory()
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
      pushHistory()
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
      pushHistory()
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
      pushHistory()
      set({ canvas: layoutCanvas(get().canvas) })
      persist()
    },

    resetToStarter: () => {
      pushHistory()
      // Same id: this resets the session's contents rather than creating another.
      set({ canvas: layoutCanvas(buildStarterCanvas()), selectedId: 'n-root', compare: [] })
    },

    newCanvas: () => {
      const c = emptyCanvas()
      syncUrl(c.id, 'push')
      // A new session starts its own history rather than inheriting the last
      // one's, so undo cannot walk backwards into a different canvas.
      set({ canvas: c, selectedId: c.rootId, compare: [], past: [], future: [] })
      persist()
    },

    addBlock: (nodeId, block) => {
      pushHistory()
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
      pushHistory(`block:${blockId}:${Object.keys(patch).join(',')}`)
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
      pushHistory()
      patchNode(nodeId, (n) => ({
        ...n,
        data: { ...n.data, blocks: n.data.blocks.filter((b) => b.id !== blockId) },
      }))
      persist()
    },

    clearRuns: (nodeId) => {
      pushHistory()
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

        // A load that leaves nothing in the cache means the browser refused to
        // store the weights — private windows and blocked site data both do
        // this. It works now and silently re-downloads on every refresh, which
        // is worth saying out loud rather than letting someone wonder.
        void cacheUsage().then((usage) => {
          if (!usage[modelId]) {
            set({
              notice: {
                kind: 'warn',
                text: 'The model loaded, but this browser did not keep a cached copy, so it will download again on refresh. Private windows and blocked site data both cause this.',
              },
            })
          }
        })
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
          if (!text.trim()) {
            // A run that ends cleanly with nothing to show is almost always a
            // backend that loaded a weight variant it cannot actually execute.
            // Saying so beats rendering an empty box.
            patchRun(nodeId, run.id, {
              status: 'error',
              error: `The model produced no output. This usually means the ${
                currentDevice() === 'wasm' ? 'CPU' : 'GPU'
              } backend cannot run the ${currentDtype() ?? 'selected'} weights. Try a different model from the Models dialog, and report it if it persists.`,
              stats,
              finishedAt: Date.now(),
            })
            return
          }
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
