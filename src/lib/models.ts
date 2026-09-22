/**
 * The local model registry.
 *
 * Every model here runs **in the browser** via transformers.js — ONNX weights
 * are downloaded once, cached by the browser, and executed on WebGPU (or WASM
 * as a fallback). There is no API, no key, and no bill, for you or for anyone
 * who opens the deployed site.
 *
 * The tradeoff is capability. These are 135M–1.7B parameter models; the smallest
 * is roughly a thousandth the size of a frontier model. See `caveat` on each
 * entry, which the UI shows rather than hides.
 */

export type ModelId =
  | 'HuggingFaceTB/SmolLM-135M-Instruct'
  | 'HuggingFaceTB/SmolLM2-360M-Instruct'
  | 'HuggingFaceTB/SmolLM2-1.7B-Instruct'

/** transformers.js quantisation selector. */
export type Dtype = 'fp16' | 'q4f16' | 'q4' | 'int8'

export interface ModelSpec {
  id: ModelId
  label: string
  /** Rough download size for the chosen dtype, in MB. Shown before committing. */
  downloadMb: number
  /** Relative weight, for the picker. One disc is fastest and weakest. */
  size: '◆' | '◆◆' | '◆◆◆'
  /** Hard context limit from the model's config.json. */
  contextTokens: number
  dtype: Dtype
  caveat: string
}

export const MODELS: Record<ModelId, ModelSpec> = {
  'HuggingFaceTB/SmolLM-135M-Instruct': {
    id: 'HuggingFaceTB/SmolLM-135M-Instruct',
    label: 'SmolLM 135M',
    downloadMb: 270,
    size: '◆',
    contextTokens: 2048,
    // 4-bit quantisation measurably degrades a model this small, so this one
    // ships at fp16 even though it costs more download than q4f16 would.
    dtype: 'fp16',
    caveat:
      'Very small. Expect loose, sometimes incoherent output — the model card itself notes it struggles with arithmetic, editing and multi-step reasoning. Good for watching how wording changes behaviour, not for judging answer quality.',
  },
  'HuggingFaceTB/SmolLM2-360M-Instruct': {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    label: 'SmolLM2 360M',
    downloadMb: 290,
    size: '◆◆',
    contextTokens: 8192,
    dtype: 'q4f16',
    caveat:
      'Noticeably steadier than 135M and with a 4x larger context window, for about the same download.',
  },
  'HuggingFaceTB/SmolLM2-1.7B-Instruct': {
    id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    label: 'SmolLM2 1.7B',
    downloadMb: 1100,
    size: '◆◆◆',
    contextTokens: 8192,
    dtype: 'q4f16',
    caveat:
      'The most coherent option here, and the only one that holds a structured format reliably. Costs a ~1.1 GB first download and needs WebGPU to be usable.',
  },
}

export const MODEL_IDS = Object.keys(MODELS) as ModelId[]

export const DEFAULT_MODEL: ModelId = 'HuggingFaceTB/SmolLM-135M-Instruct'

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatMb(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Rough token estimate for pre-flight display, since counting properly means
 * loading the tokenizer. The engine reports real counts once a run completes.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

/**
 * How close a prompt is to the model's ceiling.
 *
 * This matters far more here than it did against a hosted API. Prompt Canvas
 * composes a prompt by concatenating every ancestor's context blocks, so a deep
 * branch grows monotonically — and SmolLM 135M stops at 2048 tokens total,
 * prompt and completion combined. Overflow is silent truncation, so the UI warns
 * before you spend a minute generating from a prompt the model never fully saw.
 */
export function contextPressure(
  model: ModelId,
  promptTokens: number,
  maxNewTokens: number,
): { used: number; limit: number; ratio: number; level: 'ok' | 'tight' | 'over' } {
  const limit = MODELS[model].contextTokens
  const used = promptTokens + maxNewTokens
  const ratio = used / limit
  return {
    used,
    limit,
    ratio,
    level: ratio > 1 ? 'over' : ratio > 0.8 ? 'tight' : 'ok',
  }
}

/**
 * Which model a cached request URL belongs to, or null.
 *
 * Matched on the bounded repo path (`/<owner>/<name>/`) rather than a bare
 * substring. A plain `includes` would be a latent footgun: the moment one model
 * id is a prefix of another, deleting the shorter one would silently take the
 * longer one's weights with it.
 */
export function modelIdFromUrl(url: string): ModelId | null {
  for (const id of MODEL_IDS) {
    if (url.includes(`/${id}/`) || url.endsWith(`/${id}`)) return id
  }
  return null
}
