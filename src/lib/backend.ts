/**
 * What this machine can actually run, and what to tell the user about it.
 *
 * Worth probing *before* a download rather than after. The difference between
 * GPU and CPU here is not a detail — it is the difference between a model that
 * answers in seconds and one that appears to have hung — and the most common
 * cause of falling back to CPU is a single browser setting the user can change
 * in under a minute. Discovering that after fetching several hundred megabytes
 * is a bad trade.
 */

type BackendState =
  /** WebGPU is available and will be used. */
  | 'gpu'
  /**
   * `navigator.gpu` exists but no adapter was returned. Chrome documents this
   * as exactly what happens when "Use graphics acceleration when available" is
   * turned off, so it is both detectable and fixable.
   */
  | 'no-adapter'
  /** No WebGPU at all — an older browser, or one that does not implement it. */
  | 'unsupported'

export interface BackendInfo {
  state: BackendState
  /** Whether the adapter advertises the shader-f16 feature. */
  f16: boolean
  /** Human-readable adapter description, when the browser exposes one. */
  description?: string
}

/**
 * Probe WebGPU from the main thread.
 *
 * Deliberately separate from the worker's own probe: this one runs before any
 * weights are fetched, purely to decide what advice to show.
 */
export async function probeBackend(): Promise<BackendInfo> {
  const gpu = (
    navigator as unknown as {
      gpu?: {
        requestAdapter(): Promise<{
          features?: Set<string>
          info?: { description?: string; vendor?: string; architecture?: string }
        } | null>
      }
    }
  ).gpu

  if (!gpu) return { state: 'unsupported', f16: false }

  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return { state: 'no-adapter', f16: false }
    const info = adapter.info
    const description =
      info?.description || [info?.vendor, info?.architecture].filter(Boolean).join(' ') || undefined
    return {
      state: 'gpu',
      f16: adapter.features?.has('shader-f16') ?? false,
      description,
    }
  } catch {
    // A throwing requestAdapter is functionally the same as no adapter.
    return { state: 'no-adapter', f16: false }
  }
}

export interface BackendAdvice {
  tone: 'info' | 'warn'
  title: string
  body: string
  /** Literal settings path, shown as copyable text since browsers block such links. */
  action?: string
}

/**
 * The advice to show for a probe result, or null when there is nothing useful
 * to say. Pure, so the wording can be tested without a GPU.
 */
export function backendAdvice(info: BackendInfo): BackendAdvice | null {
  switch (info.state) {
    case 'gpu':
      // Nothing to fix. The toolbar already reports the device in use.
      return null

    case 'no-adapter':
      return {
        tone: 'warn',
        title: 'Running on CPU — your browser has graphics acceleration turned off',
        body: 'Models will still work, but generation will be many times slower, and the 1.7B model is not really usable this way. Turning hardware acceleration back on and relaunching the browser is usually a one-minute fix.',
        action:
          'Chrome or Edge: paste chrome://settings/system into the address bar, enable "Use graphics acceleration when available", then relaunch. To confirm it worked, chrome://gpu should report "WebGPU: Hardware accelerated".',
      }

    case 'unsupported':
      return {
        tone: 'warn',
        title: 'This browser does not support WebGPU — running on CPU',
        body: 'Everything works, but generation runs on the CPU and will be slow. A current Chrome, Edge, or Firefox will use your GPU instead.',
      }
  }
}
