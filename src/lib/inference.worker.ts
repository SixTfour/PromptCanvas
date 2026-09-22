/// <reference lib="webworker" />
import {
  InterruptableStoppingCriteria,
  TextStreamer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
} from '@huggingface/transformers'
import {
  dtypeCandidates,
  effectiveMaxNewTokens,
  modelIdFromUrl,
  type Dtype,
  type MaxNewTokens,
  type ModelId,
} from './models'

/**
 * Inference runs here, off the main thread.
 *
 * Generation on WASM is a tight synchronous loop; on the main thread it freezes
 * the canvas completely — no panning, no cancelling, no streaming repaint. In a
 * worker the UI stays responsive and the stop button actually works.
 *
 * One model is held at a time. Switching models disposes the previous one,
 * because holding two 1.7B graphs in WebGPU memory is a reliable way to crash
 * the tab.
 */

// Weights come from the Hugging Face CDN and are cached by the browser, so a
// reload does not re-download them.
env.allowLocalModels = false

interface Loaded {
  id: ModelId
  tokenizer: PreTrainedTokenizer
  model: PreTrainedModel
  device: 'webgpu' | 'wasm'
  dtype: Dtype
}

let loaded: Loaded | null = null
let stopper: InterruptableStoppingCriteria | null = null

type Incoming =
  | { type: 'load'; modelId: ModelId; verifiedDtype?: Dtype | null }
  | {
      type: 'generate'
      runId: string
      modelId: ModelId
      messages: ChatMessage[]
      maxNewTokens: MaxNewTokens
    }
  | { type: 'stop' }
  | { type: 'delete'; modelId: ModelId }
  | { type: 'usage' }

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg)

/**
 * WebGPU is much faster but not available everywhere; WASM keeps it working.
 *
 * Also reports whether the adapter advertises `shader-f16`, because half
 * precision on WebGPU depends on that feature rather than on WebGPU itself.
 */
async function pickBackend(): Promise<{ device: 'webgpu' | 'wasm'; f16: boolean }> {
  const gpu = (
    navigator as unknown as {
      gpu?: { requestAdapter(): Promise<{ features?: Set<string> } | null> }
    }
  ).gpu
  if (!gpu) return { device: 'wasm', f16: false }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return { device: 'wasm', f16: false }
    return { device: 'webgpu', f16: adapter.features?.has('shader-f16') ?? false }
  } catch {
    return { device: 'wasm', f16: false }
  }
}

/**
 * Does this session actually generate anything?
 *
 * The failure being guarded against is not an exception. A backend that cannot
 * execute the loaded weights will happily create a session, run generate, and
 * return an empty string. The only dependable test is to ask for a few tokens
 * and look at them.
 */
async function producesOutput(
  tokenizer: PreTrainedTokenizer,
  model: PreTrainedModel,
): Promise<boolean> {
  try {
    const inputs = tokenizer.apply_chat_template([{ role: 'user', content: 'Say hello.' }], {
      add_generation_prompt: true,
      return_dict: true,
    })
    let text = ''
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t: string) => {
        text += t
      },
    })
    await model.generate({
      ...(inputs as unknown as Record<string, unknown>),
      max_new_tokens: 8,
      do_sample: false,
      streamer,
    })
    return text.trim().length > 0
  } catch {
    return false
  }
}

async function load(modelId: ModelId, verifiedDtype?: Dtype | null) {
  if (loaded?.id === modelId) {
    post({ type: 'ready', modelId, device: loaded.device, dtype: loaded.dtype })
    return
  }

  // Free the previous model before pulling another one in.
  if (loaded) {
    try {
      await loaded.model.dispose()
    } catch {
      // Disposal is best-effort; a failure here must not block the new load.
    }
    loaded = null
  }

  const { device, f16 } = await pickBackend()
  const candidates = dtypeCandidates(modelId, device, f16, verifiedDtype)

  // Whether the weights are already here decides what the progress bar should
  // claim to be doing. Saying "downloading" during a cache read is how a fast
  // local load gets mistaken for a repeated download.
  const alreadyCached = (await cachedBytes(modelId)) > 0

  const failures: string[] = []

  for (const dtype of candidates) {
    post({ type: 'loading', modelId, device, dtype, fromCache: alreadyCached, progress: 0, file: '' })

    // transformers.js reports per-file byte progress; collapse it to one bar so
    // the UI shows a single number rather than six competing ones.
    const totals = new Map<string, { loaded: number; total: number }>()
    const onProgress = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return
      totals.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
      let done = 0
      let all = 0
      for (const v of totals.values()) {
        done += v.loaded
        all += v.total
      }
      post({
        type: 'loading',
        modelId,
        device,
        dtype,
        fromCache: alreadyCached,
        progress: all > 0 ? done / all : 0,
        file: p.file,
        loadedBytes: done,
        totalBytes: all,
      })
    }

    let tokenizer: PreTrainedTokenizer
    let model: PreTrainedModel
    try {
      tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback: onProgress })
      model = await AutoModelForCausalLM.from_pretrained(modelId, {
        dtype,
        device,
        progress_callback: onProgress,
      })
    } catch (err) {
      failures.push(`${dtype}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    // Prove it works before handing it over, rather than discovering at the
    // user's first real run that this combination emits nothing.
    post({ type: 'verifying', modelId, device, dtype })
    if (await producesOutput(tokenizer, model)) {
      loaded = { id: modelId, tokenizer, model, device, dtype }
      post({ type: 'ready', modelId, device, dtype })
      return
    }

    failures.push(`${dtype}: loaded but generated nothing on ${device}`)
    try {
      await model.dispose()
    } catch {
      // Nothing to do; we are moving on to the next candidate regardless.
    }
  }

  post({
    type: 'error',
    message: `No usable weight variant for ${modelId} on ${device}. Tried ${failures.join('; ')}.`,
  })
}

async function generate(
  runId: string,
  modelId: ModelId,
  messages: ChatMessage[],
  maxNewTokens: MaxNewTokens,
) {
  if (loaded?.id !== modelId) await load(modelId)
  if (loaded?.id !== modelId) {
    post({ type: 'run-error', runId, message: 'Model failed to load.' })
    return
  }

  const { tokenizer, model } = loaded
  stopper = new InterruptableStoppingCriteria()

  try {
    const inputs = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
    }) as { input_ids: { dims: number[] } }

    const promptTokens = inputs.input_ids.dims.at(-1) ?? 0
    // Resolved here rather than in the UI: this is the only place with a real
    // token count instead of a character-based estimate.
    const limit = effectiveMaxNewTokens(modelId, promptTokens, maxNewTokens)
    post({ type: 'run-start', runId, promptTokens, maxNewTokens: limit })

    const started = performance.now()
    let completionTokens = 0

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        completionTokens += 1
        post({ type: 'run-delta', runId, text })
      },
    })

    await model.generate({
      ...(inputs as unknown as Record<string, unknown>),
      max_new_tokens: limit,
      do_sample: false,
      streamer,
      stopping_criteria: stopper,
    })

    const elapsed = performance.now() - started
    post({
      type: 'run-done',
      runId,
      promptTokens,
      completionTokens,
      elapsedMs: elapsed,
      tokensPerSecond: elapsed > 0 ? completionTokens / (elapsed / 1000) : 0,
    })
  } catch (err) {
    post({ type: 'run-error', runId, message: err instanceof Error ? err.message : String(err) })
  } finally {
    stopper = null
  }
}

/**
 * Every Cache Storage bucket transformers.js writes to.
 *
 * Read from `env` rather than hardcoded, so a library default change does not
 * silently leave orphaned weights on disk. The hash cache is a separate bucket
 * and is easy to miss.
 */
function cacheNames(): string[] {
  const primary = (env as unknown as { cacheKey?: string }).cacheKey ?? 'transformers-cache'
  return [primary, 'experimental_transformers-hash-cache']
}

/** Bytes a cached response occupies, from its header rather than its body. */
async function entrySize(res: Response | undefined): Promise<number> {
  if (!res) return 0
  const len = res.headers.get('content-length')
  if (len) return Number(len) || 0
  // No content-length: fall back to measuring, which costs a read but is rare.
  try {
    return (await res.clone().blob()).size
  } catch {
    return 0
  }
}

/** Bytes currently cached for one model. */
async function cachedBytes(modelId: ModelId): Promise<number> {
  if (typeof caches === 'undefined') return 0
  let total = 0
  try {
    for (const name of cacheNames()) {
      if (!(await caches.has(name))) continue
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        if (modelIdFromUrl(req.url) !== modelId) continue
        total += await entrySize(await cache.match(req))
      }
    }
  } catch {
    return 0
  }
  return total
}

/** Per-model cached size, so the UI can show what deleting would reclaim. */
async function reportUsage() {
  const usage: Record<string, number> = {}
  if (typeof caches === 'undefined') {
    post({ type: 'usage', usage })
    return
  }
  try {
    for (const name of cacheNames()) {
      if (!(await caches.has(name))) continue
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        // Cache keys are the source URLs, which carry the model repo path.
        const match = modelIdFromUrl(req.url)
        if (!match) continue
        usage[match] = (usage[match] ?? 0) + (await entrySize(await cache.match(req)))
      }
    }
  } catch {
    // Storage can be unavailable or partitioned; an empty report is honest.
  }
  post({ type: 'usage', usage })
}

/**
 * Evict a model's weights.
 *
 * Disposes it first if it is the resident model, because deleting the files
 * underneath a live session leaves a model that works until reload and then
 * mysteriously does not.
 */
async function deleteModel(modelId: ModelId) {
  if (loaded?.id === modelId) {
    try {
      await loaded.model.dispose()
    } catch {
      // Best effort; the weights still go.
    }
    loaded = null
  }

  let freed = 0
  if (typeof caches !== 'undefined') {
    try {
      for (const name of cacheNames()) {
        if (!(await caches.has(name))) continue
        const cache = await caches.open(name)
        for (const req of await cache.keys()) {
          if (modelIdFromUrl(req.url) !== modelId) continue
          freed += await entrySize(await cache.match(req))
          await cache.delete(req)
        }
      }
    } catch (err) {
      post({ type: 'delete-error', modelId, message: err instanceof Error ? err.message : String(err) })
      return
    }
  }
  post({ type: 'deleted', modelId, freed })
}

self.addEventListener('message', (event: MessageEvent<Incoming>) => {
  const msg = event.data
  switch (msg.type) {
    case 'load':
      void load(msg.modelId, msg.verifiedDtype)
      break
    case 'generate':
      void generate(msg.runId, msg.modelId, msg.messages, msg.maxNewTokens)
      break
    case 'stop':
      // Interrupts the decode loop at the next token boundary.
      stopper?.interrupt()
      break
    case 'delete':
      void deleteModel(msg.modelId)
      break
    case 'usage':
      void reportUsage()
      break
  }
})
