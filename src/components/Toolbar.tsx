import { useRef, useState } from 'react'
import { currentDevice } from '../lib/engine'
import { formatError } from '../lib/errors'
import { DEFAULT_MODEL, MODELS, formatMb } from '../lib/models'
import { downloadJson, exportCanvas, importCanvas } from '../lib/storage'
import { useCanvas } from '../store/useCanvas'
import { Badge, Button, Modal } from './ui'

export function Toolbar() {
  const canvas = useCanvas((s) => s.canvas)
  const mode = useCanvas((s) => s.mode)
  const setMode = useCanvas((s) => s.setMode)
  const setCanvas = useCanvas((s) => s.setCanvas)
  const relayout = useCanvas((s) => s.relayout)
  const resetToDemo = useCanvas((s) => s.resetToDemo)
  const newCanvas = useCanvas((s) => s.newCanvas)
  const setNotice = useCanvas((s) => s.setNotice)
  const ensureModel = useCanvas((s) => s.ensureModel)
  const activeModel = useCanvas((s) => s.activeModel)
  const loading = useCanvas((s) => s.loading)
  const running = useCanvas((s) => s.running)

  const [showIntro, setShowIntro] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Whichever model the root is set to is the one Local mode will pull.
  const rootModel = canvas.nodes.find((n) => n.id === canvas.rootId)?.data.model ?? DEFAULT_MODEL
  const spec = MODELS[rootModel]
  const device = currentDevice()

  const goLocal = async () => {
    setShowIntro(false)
    const ok = await ensureModel(rootModel)
    if (ok) {
      setMode('local')
      setNotice({
        kind: 'info',
        text: `${spec.label} is running locally on ${
          currentDevice() === 'webgpu' ? 'your GPU' : 'CPU'
        }. Nothing leaves this machine.`,
      })
    }
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tracking-tight">Prompt Canvas</span>
          <span className="text-[13px] text-[var(--color-muted)]">/</span>
          <input
            value={canvas.name}
            onChange={(e) => setCanvas({ ...canvas, name: e.target.value })}
            className="w-52 bg-transparent text-[13px] text-[var(--color-muted)] focus:text-[var(--color-ink)] focus:outline-none"
          />
        </div>

        <div className="ml-2 flex items-center gap-1.5">
          {mode === 'demo' ? (
            <Badge tone="accent">sample data — nothing is generated</Badge>
          ) : (
            <Badge tone="good">
              local — {MODELS[activeModel ?? rootModel].label}
              {device ? ` on ${device === 'webgpu' ? 'GPU' : 'CPU'}` : ''}
            </Badge>
          )}
          {running > 0 && <Badge tone="warn">generating</Badge>}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              newCanvas()
              setNotice({ kind: 'info', text: 'Started a blank canvas.' })
            }}
            title="Start an empty canvas"
          >
            New
          </Button>
          <Button size="sm" variant="ghost" onClick={relayout} title="Re-run auto-layout">
            Tidy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              downloadJson(
                `${canvas.name.replace(/[^\w-]+/g, '-').toLowerCase()}.promptcanvas.json`,
                exportCanvas(canvas),
              )
            }
          >
            Export
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                setCanvas(importCanvas(await file.text()))
                setNotice({ kind: 'info', text: `Imported "${file.name}".` })
              } catch (err) {
                setNotice({ kind: 'error', text: formatError(err) })
              } finally {
                e.target.value = ''
              }
            }}
          />

          {mode === 'demo' ? (
            <Button
              size="sm"
              variant="primary"
              disabled={Boolean(loading)}
              onClick={() => setShowIntro(true)}
            >
              {loading ? 'Loading model…' : 'Run it for real'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode('demo')
                setNotice({ kind: 'info', text: 'Back to sample data.' })
              }}
              title="Stop using the local model and show the bundled samples"
            >
              Sample mode
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              resetToDemo()
              setNotice({ kind: 'info', text: 'Sample canvas restored.' })
            }}
            title="Reload the bundled sample canvas"
          >
            Reset
          </Button>
        </div>
      </header>

      {showIntro && (
        <Modal title={`Run ${spec.label} in your browser`} onClose={() => setShowIntro(false)}>
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed">
              This downloads <strong>{formatMb(spec.downloadMb)}</strong> of model weights from
              Hugging Face, once, and then runs everything on this machine. There is no account, no
              API key, and no cost — to you or to anyone who opens this page.
            </p>

            <ul className="space-y-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
              <li>
                <strong className="text-[var(--color-ink)]">Private by construction.</strong> Your
                prompts never leave the browser. Nothing is sent anywhere once the weights are
                fetched, and it works offline afterwards.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Cached.</strong> The download happens
                once per browser. Reloads are instant.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Runs on your GPU where possible.</strong>{' '}
                WebGPU is used if available, with a slower CPU fallback otherwise.
              </li>
            </ul>

            <div className="rounded-md border border-[var(--color-warn)]/40 bg-[#3a3218]/30 p-3">
              <p className="text-[12px] font-semibold text-[var(--color-warn)]">
                What to expect from {spec.label}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
                {spec.caveat}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                This is the honest trade for &ldquo;free and private&rdquo;. Branching, diffing and
                merging all still work, and a small model is unusually sensitive to wording, so
                prompt changes show up clearly. Just do not read its answers as authoritative.
                Sample mode shows what a strong model produces for the same prompts.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void goLocal()}>
                Download and run
              </Button>
              <Button variant="ghost" onClick={() => setShowIntro(false)}>
                Stay on sample data
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
