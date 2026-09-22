import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { CanvasView } from './components/Canvas'
import { CompareTray } from './components/CompareTray'
import { Inspector } from './components/Inspector'
import { ModelPicker } from './components/ModelPicker'
import { Toolbar } from './components/Toolbar'
import { downloadedModels } from './lib/engine'
import { isRedo, isTypingTarget, isUndo } from './lib/keys'
import { formatMb } from './lib/models'
import { useCanvas } from './store/useCanvas'

export default function App() {
  const notice = useCanvas((s) => s.notice)
  const setNotice = useCanvas((s) => s.setNotice)
  const compare = useCanvas((s) => s.compare)
  const loading = useCanvas((s) => s.loading)
  const undo = useCanvas((s) => s.undo)
  const redo = useCanvas((s) => s.redo)

  // Nothing on this machine yet: the first thing to decide is which weights to
  // pull, so ask before showing a canvas whose Run button would do nothing.
  const [showFirstRun, setShowFirstRun] = useState(() => downloadedModels().length === 0)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Inside a field, the browser's own text undo is the right behaviour;
      // rolling back the whole canvas mid-sentence would not be.
      if (isTypingTarget(e.target)) return
      if (isUndo(e)) {
        e.preventDefault()
        undo()
      } else if (isRedo(e)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  return (
    <div className="flex h-full flex-col">
      <Toolbar />

      {/* First run pulls a few hundred MB of weights; a bare spinner would be
          indistinguishable from the app having hung. */}
      {loading && (
        <div className="border-b border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2">
          <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
            <span>
              {loading.verifying
                ? 'Checking this weight variant runs on your hardware'
                : loading.fromCache
                  ? 'Loading model from cache'
                  : 'Downloading model weights — once per browser, then cached'}
              {loading.dtype ? ` · ${loading.dtype}` : ''}
              {loading.device === 'wasm' ? ' · WebGPU unavailable, running on CPU' : ''}
            </span>
            <span>
              {loading.totalBytes
                ? `${formatMb(Math.round((loading.loadedBytes ?? 0) / 1e6))} / ${formatMb(
                    Math.round(loading.totalBytes / 1e6),
                  )}`
                : `${Math.round(loading.progress * 100)}%`}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded bg-[var(--color-edge)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
              style={{ width: `${Math.max(2, loading.progress * 100)}%` }}
            />
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ReactFlowProvider>
              <CanvasView />
            </ReactFlowProvider>
          </div>
          {compare.length > 0 && (
            <div className="h-[38%] min-h-[220px]">
              <CompareTray />
            </div>
          )}
        </div>
        <aside className="w-[440px] shrink-0 border-l border-[var(--color-edge)] bg-[var(--color-panel)]">
          <Inspector />
        </aside>
      </div>

      {showFirstRun && <ModelPicker firstRun onClose={() => setShowFirstRun(false)} />}

      {notice && (
        <div
          className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 whitespace-pre-line rounded-md border px-3.5 py-2.5 text-[13px] leading-relaxed shadow-xl ${
            notice.kind === 'error'
              ? 'border-[var(--color-danger)]/50 bg-[#2a1618] text-[var(--color-danger)]'
              : notice.kind === 'warn'
                ? 'border-[var(--color-warn)]/50 bg-[#2a2412] text-[var(--color-warn)]'
                : 'border-[var(--color-edge)] bg-[var(--color-panel)] text-[var(--color-ink)]'
          }`}
          role="status"
        >
          <button
            onClick={() => setNotice(null)}
            className="float-right ml-3 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
          {notice.text}
        </div>
      )}
    </div>
  )
}
