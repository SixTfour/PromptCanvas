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

export async function saveCanvas(canvas: Canvas): Promise<void> {
  await set(PREFIX + canvas.id, { ...canvas, updatedAt: Date.now() })
}

export async function loadCanvas(id: string): Promise<Canvas | undefined> {
  return get<Canvas>(PREFIX + id)
}

export async function deleteCanvas(id: string): Promise<void> {
  await del(PREFIX + id)
}

export async function listCanvases(): Promise<Array<Pick<Canvas, 'id' | 'name' | 'updatedAt'>>> {
  const allKeys = await keys()
  const ids = allKeys
    .filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX))
    .map((k) => k.slice(PREFIX.length))
  const out = await Promise.all(
    ids.map(async (id) => {
      const c = await loadCanvas(id)
      return c ? { id: c.id, name: c.name, updatedAt: c.updatedAt } : null
    }),
  )
  return out
    .filter((c): c is Pick<Canvas, 'id' | 'name' | 'updatedAt'> => c !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
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
