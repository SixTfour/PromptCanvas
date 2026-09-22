import type { ComposedPrompt } from '../types'
import { DEFAULT_MODEL, type Dtype, type ModelId } from './models'

/**
 * Main-thread client for the inference worker.
 *
 * Owns the single worker instance, tracks load progress, and turns the worker's
 * message stream back into promises the store can await.
 */

export interface LoadProgress {
  modelId: ModelId
  device: 'webgpu' | 'wasm'
  /** The weight variant chosen for this machine. */
  dtype?: Dtype
  /** True when the weights were already cached, so this is a read not a fetch. */
  fromCache?: boolean
  progress: number
  file: string
  loadedBytes?: number
  totalBytes?: number
}

export interface RunStats {
  promptTokens: number
  completionTokens: number
  elapsedMs: number
  tokensPerSecond: number
}

export interface GenerateHandlers {
  onStart?: (promptTokens: number) => void
  onText: (delta: string) => void
}

type Listener = (p: LoadProgress | null) => void

/**
 * Which models this browser has successfully downloaded.
 *
 * transformers.js caches weights in Cache Storage, but its key layout is an
 * implementation detail we should not probe. A local record of what has loaded
 * at least once is honest about what it is: a hint for the UI, not a guarantee
 * the cache is still warm. A cleared cache just means one more download.
 */
const LS_DOWNLOADED = 'promptcanvas.downloadedModels'

export function downloadedModels(): ModelId[] {
  try {
    const raw = localStorage.getItem(LS_DOWNLOADED)
    return raw ? (JSON.parse(raw) as ModelId[]) : []
  } catch {
    return []
  }
}

export function isDownloaded(modelId: ModelId): boolean {
  return downloadedModels().includes(modelId)
}

function markDownloaded(modelId: ModelId) {
  try {
    const all = new Set(downloadedModels())
    all.add(modelId)
    localStorage.setItem(LS_DOWNLOADED, JSON.stringify([...all]))
  } catch {
    // Private browsing and blocked storage are fine; this is only a hint.
  }
}

function unmarkDownloaded(modelId: ModelId) {
  try {
    const left = downloadedModels().filter((m) => m !== modelId)
    localStorage.setItem(LS_DOWNLOADED, JSON.stringify(left))
  } catch {
    /* only a hint */
  }
}

export function forgetDownloaded(): void {
  try {
    localStorage.removeItem(LS_DOWNLOADED)
  } catch {
    /* nothing to do */
  }
}

let worker: Worker | null = null
let readyModel: ModelId | null = null
let device: 'webgpu' | 'wasm' | null = null
let activeDtype: Dtype | null = null
const progressListeners = new Set<Listener>()

let usageResolve: ((u: Partial<Record<ModelId, number>>) => void) | null = null
let deleteResolve: ((freed: number) => void) | null = null
let deleteReject: ((e: Error) => void) | null = null

/**
 * Everyone waiting on the current load.
 *
 * A single shared slot was a bug: a second caller arriving mid-load replaced
 * the first caller's resolver, so that promise never settled and whatever was
 * awaiting it hung forever. Loads are fanned out to every waiter instead.
 */
const loadWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []
let loadingModel: ModelId | null = null

/** Resolvers for in-flight operations, keyed by run id. */
const pending = new Map<
  string,
  { resolve: (v: RunStats) => void; reject: (e: Error) => void; handlers?: GenerateHandlers }
>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (e: MessageEvent<Record<string, unknown>>) => {
    const msg = e.data
    switch (msg.type) {
      case 'loading':
        notify(msg as unknown as LoadProgress)
        break
      case 'ready': {
        readyModel = msg.modelId as ModelId
        device = msg.device as 'webgpu' | 'wasm'
        activeDtype = (msg.dtype as Dtype) ?? null
        markDownloaded(readyModel)
        notify(null)
        // Every caller that asked for this load gets the same answer.
        for (const w of loadWaiters) w.resolve()
        loadWaiters.length = 0
        loadingModel = null
        break
      }
      case 'error': {
        notify(null)
        const err = new Error(String(msg.message ?? 'Model failed to load.'))
        for (const w of loadWaiters) w.reject(err)
        loadWaiters.length = 0
        loadingModel = null
        break
      }
      case 'run-start':
        pending.get(String(msg.runId))?.handlers?.onStart?.(Number(msg.promptTokens ?? 0))
        break
      case 'run-delta':
        pending.get(String(msg.runId))?.handlers?.onText(String(msg.text ?? ''))
        break
      case 'run-done': {
        const id = String(msg.runId)
        pending.get(id)?.resolve({
          promptTokens: Number(msg.promptTokens ?? 0),
          completionTokens: Number(msg.completionTokens ?? 0),
          elapsedMs: Number(msg.elapsedMs ?? 0),
          tokensPerSecond: Number(msg.tokensPerSecond ?? 0),
        })
        pending.delete(id)
        break
      }
      case 'run-error': {
        const id = String(msg.runId)
        pending.get(id)?.reject(new Error(String(msg.message ?? 'Generation failed.')))
        pending.delete(id)
        break
      }
      case 'usage':
        usageResolve?.(msg.usage as Partial<Record<ModelId, number>>)
        usageResolve = null
        break
      case 'deleted': {
        const id = msg.modelId as ModelId
        if (readyModel === id) {
          readyModel = null
          device = null
          activeDtype = null
        }
        unmarkDownloaded(id)
        deleteResolve?.(Number(msg.freed ?? 0))
        deleteResolve = null
        deleteReject = null
        break
      }
      case 'delete-error':
        deleteReject?.(new Error(String(msg.message ?? 'Could not delete the model.')))
        deleteResolve = null
        deleteReject = null
        break
    }
  })
  return worker
}

function notify(p: LoadProgress | null) {
  for (const l of progressListeners) l(p)
}

export function onLoadProgress(listener: Listener): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

export function currentDevice(): 'webgpu' | 'wasm' | null {
  return device
}

/** The weight variant the resident model was loaded with. */
export function currentDtype(): Dtype | null {
  return activeDtype
}

export function isModelReady(modelId: ModelId = DEFAULT_MODEL): boolean {
  return readyModel === modelId
}

/** The model currently resident in the worker, if any. */
export function loadedModel(): ModelId | null {
  return readyModel
}

/** Download and initialise a model. Safe to call repeatedly and concurrently. */
export function loadModel(modelId: ModelId): Promise<void> {
  if (readyModel === modelId) return Promise.resolve()
  const w = ensureWorker()
  const waiting = new Promise<void>((resolve, reject) => loadWaiters.push({ resolve, reject }))
  // Join the load already in flight for this model rather than starting another.
  if (loadingModel !== modelId) {
    loadingModel = modelId
    w.postMessage({ type: 'load', modelId })
  }
  return waiting
}

export type ChatMessage = { role: 'system' | 'user'; content: string }

/**
 * Turn a composed prompt into chat messages.
 *
 * The SmolLM chat templates do accept a `system` role — verified against the
 * 135M tokenizer rather than assumed — so the system prompt is sent as its own
 * turn instead of being glued onto the front of the user message.
 */
export function toMessages(prompt: ComposedPrompt): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (prompt.system.trim()) messages.push({ role: 'system', content: prompt.system.trim() })
  messages.push({ role: 'user', content: prompt.text.trim() || 'Hello.' })
  return messages
}

/**
 * Serialises generations.
 *
 * There is one model instance in one worker, and `model.generate` is not
 * reentrant — firing two at once interleaves their decode loops and corrupts
 * both outputs. Against a hosted API you would fan out; here everything queues.
 */
let queue: Promise<unknown> = Promise.resolve()

export function generate(
  runId: string,
  modelId: ModelId,
  prompt: ComposedPrompt,
  maxNewTokens: number,
  handlers: GenerateHandlers,
): Promise<RunStats> {
  const run = queue.then(async () => {
    const w = ensureWorker()
    await loadModel(modelId)
    return new Promise<RunStats>((resolve, reject) => {
      pending.set(runId, { resolve, reject, handlers })
      w.postMessage({
        type: 'generate',
        runId,
        modelId,
        messages: toMessages(prompt),
        maxNewTokens,
      })
    })
  })
  // Keep the chain alive even when one run fails, or the queue wedges shut.
  queue = run.catch(() => undefined)
  return run
}

/** How many generations are waiting or running. */
export function queueDepth(): number {
  return pending.size - (pending.has('@load') ? 1 : 0)
}

/** Bytes each model currently occupies in the browser cache. */
export function cacheUsage(): Promise<Partial<Record<ModelId, number>>> {
  const w = ensureWorker()
  return new Promise((resolve) => {
    usageResolve = resolve
    w.postMessage({ type: 'usage' })
    // Storage APIs can be blocked outright; do not leave the UI spinning.
    setTimeout(() => {
      if (usageResolve === resolve) {
        usageResolve = null
        resolve({})
      }
    }, 8000)
  })
}

/**
 * Delete a model's cached weights, returning the bytes reclaimed.
 *
 * Runs in the worker so it can dispose the model first and read the library's
 * own cache key rather than a hardcoded copy of it.
 */
export function deleteModel(modelId: ModelId): Promise<number> {
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    deleteResolve = resolve
    deleteReject = reject
    w.postMessage({ type: 'delete', modelId })
  })
}

/** Total bytes this origin is using, when the browser will say. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est || est.usage === undefined) return null
    return { usage: est.usage, quota: est.quota ?? 0 }
  } catch {
    return null
  }
}

/** Interrupt the decode loop. The in-flight promise resolves with what it has. */
export function stopGeneration(): void {
  worker?.postMessage({ type: 'stop' })
}
