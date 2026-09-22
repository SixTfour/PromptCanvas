import type { ComposedPrompt } from '../types'
import { DEFAULT_MODEL, type ModelId } from './models'

/**
 * Main-thread client for the inference worker.
 *
 * Owns the single worker instance, tracks load progress, and turns the worker's
 * message stream back into promises the store can await.
 */

export interface LoadProgress {
  modelId: ModelId
  device: 'webgpu' | 'wasm'
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

let worker: Worker | null = null
let readyModel: ModelId | null = null
let device: 'webgpu' | 'wasm' | null = null
const progressListeners = new Set<Listener>()

/** Resolvers for in-flight operations, keyed by run id (or '@load'). */
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
        notify(null)
        pending.get('@load')?.resolve({
          promptTokens: 0,
          completionTokens: 0,
          elapsedMs: 0,
          tokensPerSecond: 0,
        })
        pending.delete('@load')
        break
      }
      case 'error': {
        notify(null)
        const err = new Error(String(msg.message ?? 'Model failed to load.'))
        pending.get('@load')?.reject(err)
        pending.delete('@load')
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

export function isModelReady(modelId: ModelId = DEFAULT_MODEL): boolean {
  return readyModel === modelId
}

/** Download and initialise a model. Safe to call repeatedly. */
export function loadModel(modelId: ModelId): Promise<unknown> {
  if (readyModel === modelId) return Promise.resolve(null)
  const existing = pending.get('@load')
  if (existing) return new Promise((resolve, reject) => pending.set('@load', { resolve, reject }))
  const w = ensureWorker()
  const p = new Promise<RunStats>((resolve, reject) => pending.set('@load', { resolve, reject }))
  w.postMessage({ type: 'load', modelId })
  return p
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

/** Interrupt the decode loop. The in-flight promise resolves with what it has. */
export function stopGeneration(): void {
  worker?.postMessage({ type: 'stop' })
}
