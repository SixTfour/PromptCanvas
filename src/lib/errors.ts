/**
 * Turning thrown things into something a person can act on.
 *
 * Running inference in the browser trades one failure surface for another.
 * There are no HTTP status codes any more, but there is a 270 MB download that
 * can stall, a WebGPU adapter that can vanish, and an out-of-memory kill that
 * arrives as an unhelpful RuntimeError from deep inside ONNX Runtime. Those all
 * need translating, or the UI just shows a stack-trace fragment.
 */

export interface FriendlyError {
  /** One sentence naming what went wrong. */
  message: string
  /** What to do about it, when there is something useful to say. */
  hint?: string
}

/** Signature -> copy. Matched against the raw error text, most specific first. */
const PATTERNS: Array<{ test: RegExp; message: string; hint?: string }> = [
  {
    test: /out of memory|oom|allocation failed|failed to allocate/i,
    message: 'The browser ran out of memory loading or running this model.',
    hint: 'Close other tabs and try again, or pick a smaller model. SmolLM 135M needs the least.',
  },
  {
    test: /webgpu|gpu adapter|requestadapter|device lost/i,
    message: 'WebGPU is unavailable or the graphics device was lost.',
    hint: 'The app falls back to CPU automatically, which is slower but works. Reload to retry with WebGPU.',
  },
  {
    test: /failed to fetch|networkerror|load model|could not locate|404/i,
    message: 'The model files could not be downloaded.',
    hint: 'Check your connection. Weights come from huggingface.co on first use; after that they are cached and work offline.',
  },
  {
    test: /quota|storage full|exceeded the quota/i,
    message: 'This browser is out of storage.',
    hint: 'Cached model weights and saved canvases share the same quota. Export anything you want to keep, then clear this site\u2019s data.',
  },
  {
    test: /unsupported|no available backend|wasm|simd/i,
    message: 'This browser cannot run the model runtime.',
    hint: 'A current version of Chrome, Edge, or Firefox is needed. Safari support is partial.',
  },
  {
    test: /abort|interrupt|cancel/i,
    message: 'Cancelled.',
  },
]

export function friendlyError(err: unknown): FriendlyError {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : ''

  for (const p of PATTERNS) {
    if (p.test.test(raw)) return { message: p.message, hint: p.hint }
  }

  if (err instanceof SyntaxError) {
    return {
      message: 'That file is not valid JSON.',
      hint: 'Import expects a file produced by Export.',
    }
  }

  if (err instanceof Error && err.message.trim()) {
    return { message: err.message }
  }

  return { message: 'Something went wrong.' }
}

/** Flatten to a single string, for places that can only hold one. */
export function formatError(err: unknown): string {
  const f = friendlyError(err)
  return f.hint ? `${f.message}\n\n${f.hint}` : f.message
}
