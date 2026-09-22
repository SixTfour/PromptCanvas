import { del, get, keys, set } from 'idb-keyval'
import type { Canvas } from '../types'

/**
 * Persistence.
 *
 * IndexedDB rather than localStorage: a canvas with a few dozen streamed
 * responses runs to megabytes, and localStorage's ~5 MB ceiling is both small
 * and, when you hit it, a silent quota exception mid-write.
 *
 * Canvases are stored in the clear. They are the user's own prompt text, they
 * never leave this machine, and encrypting them under a key the page also holds
 * would be theatre.
 */

const PREFIX = 'canvas:'
const LAST_OPENED = 'promptcanvas.lastCanvasId'

/**
 * Write a canvas, keeping its own `updatedAt`.
 *
 * Stamping the save time here made "last edited" mean "last written", and the
 * app writes for reasons that are not edits — saving the outgoing canvas when
 * switching sessions, persisting on restore. Merely opening a different session
 * would float the one you left to the top of the list. The store sets
 * `updatedAt` when something actually changes; this just records it.
 */
export async function saveCanvas(canvas: Canvas): Promise<void> {
  await set(PREFIX + canvas.id, { ...canvas, updatedAt: canvas.updatedAt || Date.now() })
}

export async function loadCanvas(id: string): Promise<Canvas | undefined> {
  return get<Canvas>(PREFIX + id)
}

export async function deleteCanvas(id: string): Promise<void> {
  await del(PREFIX + id)
}

export interface CanvasSummary {
  id: string
  name: string
  updatedAt: number
  nodeCount: number
  /** Generated responses across the whole canvas, which is what makes a session worth reopening. */
  runCount: number
  /**
   * Lowercased searchable text: the name, node titles and prompt bodies.
   *
   * Built here because listing already reads every canvas in full to count
   * runs, so searching prompt content costs nothing extra. Capped, since the
   * point is to find a session rather than to index it.
   */
  haystack: string
}

const HAYSTACK_LIMIT = 4000

export async function listCanvases(): Promise<CanvasSummary[]> {
  const allKeys = await keys()
  const ids = allKeys
    .filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX))
    .map((k) => k.slice(PREFIX.length))
  const out = await Promise.all(
    ids.map(async (id) => {
      const c = await loadCanvas(id)
      if (!c) return null
      return { ...summarise(c) }
    }),
  )
  return out
    .filter((c): c is CanvasSummary => c !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * A session id trimmed for display.
 *
 * Ids generated here are already short (`c-` plus eight characters), but an
 * imported canvas can carry anything, and a sidebar row is not the place to
 * discover that. Keeps both ends, since the tail is what distinguishes two ids
 * that share a prefix.
 */
export function shortSessionId(id: string, max = 14): string {
  if (id.length <= max) return id
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${id.slice(0, head)}…${id.slice(-tail)}`
}

/** Everything the session list shows, derived from a canvas in memory. */
export function summarise(c: Canvas): CanvasSummary {
  const parts: string[] = [c.name]
  for (const n of c.nodes) {
    parts.push(n.data.title)
    if (n.data.system) parts.push(n.data.system)
    if (n.data.instruction) parts.push(n.data.instruction)
    for (const b of n.data.blocks) parts.push(b.label, b.text)
  }
  return {
    id: c.id,
    name: c.name,
    updatedAt: c.updatedAt,
    nodeCount: c.nodes.length,
    runCount: c.nodes.reduce((n, node) => n + node.data.runs.length, 0),
    haystack: parts.join(' ').toLowerCase().slice(0, HAYSTACK_LIMIT),
  }
}

/** Copy a saved canvas under a new id, so the original is left untouched. */
export async function duplicateCanvas(id: string, newId: string): Promise<Canvas | undefined> {
  const source = await loadCanvas(id)
  if (!source) return undefined
  const copy: Canvas = {
    ...source,
    id: newId,
    name: `${source.name} copy`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await saveCanvas(copy)
  return copy
}

export function rememberLastCanvas(id: string): void {
  localStorage.setItem(LAST_OPENED, id)
}

export function getLastCanvasId(): string | null {
  return localStorage.getItem(LAST_OPENED)
}

/**
 * Export a canvas as JSON. This doubles as the sharing format and as the shape
 * the bundled starter canvas is authored in, so there is one schema to maintain
 * rather than two that drift.
 */
export function exportCanvas(canvas: Canvas): string {
  return JSON.stringify({ format: 'promptcanvas.v1', canvas }, null, 2)
}

export function importCanvas(json: string): Canvas {
  const parsed = JSON.parse(json) as { format?: string; canvas?: Canvas }
  if (parsed.format !== 'promptcanvas.v1' || !parsed.canvas) {
    throw new Error('Not a Prompt Canvas export (expected format "promptcanvas.v1").')
  }
  const c = parsed.canvas
  if (!Array.isArray(c.nodes) || !Array.isArray(c.edges) || !c.rootId) {
    throw new Error('Export is missing nodes, edges, or a root node.')
  }
  return c
}

export function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
