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
    test: /content security policy|refused to connect|blocked by cors|cross-origin/i,
    message: 'The browser blocked a request the model needed.',
    hint: 'Usually a Content Security Policy that does not list the host serving the weights. The browser console names the blocked URL.',
  },
  {
    /*
     * Wrong MIME type on the runtime's .wasm. Only bites on a deployed build:
     * a dev server guesses the type, a CDN states it, and a wrong statement is
     * fatal once X-Content-Type-Options is nosniff.
     */
    test: /incorrect response mime type|magic word|expected magic word|not a wasm module/i,
    message: 'The model runtime was served with the wrong content type.',
    hint: 'WebAssembly files must be served as application/wasm. Check the host is not labelling .wasm as octet-stream.',
  },
  {
    test: /failed to fetch|networkerror|load model|could not locate|404/i,
    message: 'The model files could not be downloaded.',
    hint: 'Check your connection. Weights come from huggingface.co on first use; after that they are cached and work offline.',
  },
  {
    // Deliberately below the specific signatures: almost every backend failure
    // mentions webgpu somewhere, so matching it early buries the real cause.
    test: /webgpu|gpu adapter|requestadapter|device lost/i,
    message: 'WebGPU is unavailable or the graphics device was lost.',
    hint: 'The app falls back to CPU automatically, which is slower but works. Reload to retry with WebGPU.',
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

/**
 * The loader's summary when every weight variant failed.
 *
 * It names the device it was trying, which meant a generic match on "webgpu"
 * claimed it first and reported a graceful CPU fallback that had not happened,
 * throwing away the per-variant reasons that say what actually went wrong.
 */
const COMPOSITE = /^No usable weight variant for (\S+) on (\w+)\. Tried ([\s\S]+)\.$/

export function friendlyError(err: unknown): FriendlyError {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : ''

  const composite = COMPOSITE.exec(err instanceof Error ? err.message : raw)
  if (composite) {
    const [, , device, detail] = composite
    // Classify the underlying reason, not the wrapper around it.
    const inner = PATTERNS.find((p) => p.test.test(detail))
    return {
      message: `No weight variant would load on ${device === 'wasm' ? 'CPU' : 'GPU'}.`,
      hint: [inner?.hint, `Reported: ${detail.trim()}`].filter(Boolean).join(' '),
    }
  }

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
