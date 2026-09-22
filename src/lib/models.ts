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
export type Dtype = 'fp32' | 'fp16' | 'q8' | 'q4f16' | 'q4' | 'int8'

export type Backend = 'webgpu' | 'wasm'

/**
 * Weight variants to try for a given backend, best first.
 *
 * A list rather than a single choice, because there is no reliable way to
 * predict from the outside what ONNX Runtime Web will actually execute.
 * `shader-f16` being advertised by the adapter is necessary for fp16 but
 * demonstrably not sufficient: an adapter reporting it can still load
 * model_fp16.onnx, initialise a session, and then generate nothing at all.
 *
 * So the loader works down the list and keeps the first variant that provably
 * produces tokens. Ordering trades quality against the odds of working, and
 * against download size, since a rejected candidate is a wasted fetch.
 */
interface DtypeChoices {
  /** Tried in order on WebGPU. */
  webgpu: Dtype[]
  /** Tried in order on CPU. */
  wasm: Dtype[]
}

export interface ModelSpec {
  id: ModelId
  label: string
  /** Rough download size for the chosen dtype, in MB. Shown before committing. */
  downloadMb: number
  /** Relative weight, for the picker. One disc is fastest and weakest. */
  size: '◆' | '◆◆' | '◆◆◆'
  /** Hard context limit from the model's config.json. */
  contextTokens: number
  dtypes: DtypeChoices
  caveat: string
}

export const MODELS: Record<ModelId, ModelSpec> = {
  'HuggingFaceTB/SmolLM-135M-Instruct': {
    id: 'HuggingFaceTB/SmolLM-135M-Instruct',
    label: 'SmolLM 135M',
    downloadMb: 270,
    size: '◆',
    contextTokens: 2048,
    // q4f16 leads on WebGPU because it is what the transformers.js ecosystem
    // actually runs there. 4-bit does blunt a model this small, but a working
    // 4-bit model beats an fp16 one that silently emits nothing. fp32 is the
    // last resort: compatible, and a 540 MB download.
    dtypes: { webgpu: ['q4f16', 'fp32'], wasm: ['q8', 'fp32'] },
    caveat:
      'Very small. Expect loose, sometimes incoherent output — the model card itself notes it struggles with arithmetic, editing and multi-step reasoning. Good for watching how wording changes behaviour, not for judging answer quality.',
  },
  'HuggingFaceTB/SmolLM2-360M-Instruct': {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    label: 'SmolLM2 360M',
    downloadMb: 290,
    size: '◆◆',
    contextTokens: 8192,
    dtypes: { webgpu: ['q4f16', 'q4'], wasm: ['q8', 'q4'] },
    caveat:
      'Noticeably steadier than 135M and with a 4x larger context window, for about the same download.',
  },
  'HuggingFaceTB/SmolLM2-1.7B-Instruct': {
    id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    label: 'SmolLM2 1.7B',
    downloadMb: 1100,
    size: '◆◆◆',
    contextTokens: 8192,
    // Never fp32/fp16 here: both carry external .onnx_data weights running to
    // several GB, which is not a reasonable browser download.
    dtypes: { webgpu: ['q4f16', 'q4'], wasm: ['q8', 'q4'] },
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
/**
 * Weight variants to attempt on this machine, best first.
 *
 * `verified` is a variant already proven to work here on a previous visit; it
 * goes to the front so a returning user pays no probing cost. Half-precision
 * candidates are dropped entirely when the adapter lacks `shader-f16`, since
 * those cannot work — that check is still worth doing, it just is not enough
 * on its own.
 *
 * Kept pure and separate from the worker so it can be tested without a GPU,
 * a browser, or a download.
 */
export function dtypeCandidates(
  model: ModelId,
  backend: Backend,
  supportsF16: boolean,
  verified?: Dtype | null,
): Dtype[] {
  const listed = MODELS[model].dtypes[backend]
  const usable =
    backend === 'webgpu' && !supportsF16
      ? listed.filter((d) => !HALF_PRECISION.includes(d))
      : listed
  // Never end up with nothing to try.
  const ordered = usable.length > 0 ? usable : ['fp32' as Dtype]
  if (verified && ordered.includes(verified)) {
    return [verified, ...ordered.filter((d) => d !== verified)]
  }
  return ordered
}

/** Variants whose compute is half precision, and so need GPU support for it. */
export const HALF_PRECISION: Dtype[] = ['fp16', 'q4f16']

export function modelIdFromUrl(url: string): ModelId | null {
  for (const id of MODEL_IDS) {
    if (url.includes(`/${id}/`) || url.endsWith(`/${id}`)) return id
  }
  return null
}

/**
 * How many tokens a node may generate.
 *
 * `'auto'` means "whatever is left", which is the right answer almost always:
 * the ceiling is the model's context window minus the prompt, and the prompt is
 * the part that changes as you branch. Picking a number by hand only matters
 * when you want output deliberately shorter than it could be.
 */
export type MaxNewTokens = number | 'auto'

/** Small reserve so an off-by-a-few token estimate cannot overflow the window. */
const AUTO_MARGIN = 8

/**
 * How many tokens a node may actually generate.
 *
 * The ceiling is always the model's own maximum, reduced by whatever the prompt
 * has already taken. A stored number is treated as a *cap you asked for*, not a
 * demand — it is lowered to fit rather than overflowing the window, because a
 * number chosen when a branch was shallow should not start truncating prompts
 * three corrections later.
 *
 * `'auto'`, the default, is simply no cap of your own: the model's maximum,
 * minus the prompt.
 *
 * `promptTokens` should be a real count where one is available — the worker has
 * one after applying the chat template — and an estimate elsewhere.
 */
export function effectiveMaxNewTokens(
  model: ModelId,
  promptTokens: number,
  setting: MaxNewTokens,
  minimum = 16,
): number {
  const limit = MODELS[model].contextTokens
  const available = limit - promptTokens - AUTO_MARGIN
  const capped = setting === 'auto' ? available : Math.min(setting, available)
  // Never zero or negative: a prompt that fills the window is reported by
  // contextPressure rather than silently producing a model that cannot speak.
  return Math.max(minimum, capped)
}

/** The largest response this model could ever produce, ignoring the prompt. */
export function modelMaxNewTokens(model: ModelId): number {
  return MODELS[model].contextTokens
}
