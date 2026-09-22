import { useRef, useState } from 'react'
import { currentDevice, currentDtype, loadedModel } from '../lib/engine'
import { formatError } from '../lib/errors'
import { shortcutLabels } from '../lib/keys'
import { MODELS } from '../lib/models'
import { downloadJson, exportCanvas, importCanvas } from '../lib/storage'
import { useCanvas } from '../store/useCanvas'
import { ModelPicker } from './ModelPicker'
import { Badge, Button } from './ui'

export function Toolbar() {
  const canvas = useCanvas((s) => s.canvas)
  const setCanvas = useCanvas((s) => s.setCanvas)
  const relayout = useCanvas((s) => s.relayout)
  const resetToStarter = useCanvas((s) => s.resetToStarter)
  const newCanvas = useCanvas((s) => s.newCanvas)
  const setNotice = useCanvas((s) => s.setNotice)
  const activeModel = useCanvas((s) => s.activeModel)
  const loading = useCanvas((s) => s.loading)
  const running = useCanvas((s) => s.running)
  const undo = useCanvas((s) => s.undo)
  const redo = useCanvas((s) => s.redo)
  const canUndo = useCanvas((s) => s.past.length > 0)
  const canRedo = useCanvas((s) => s.future.length > 0)

  const [showModels, setShowModels] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const resident = activeModel ?? loadedModel()
  const device = currentDevice()
  const keys = shortcutLabels()
  const dtype = currentDtype()

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
          {resident ? (
            <button
              onClick={() => setShowModels(true)}
              title="Change model"
              className="rounded hover:opacity-80"
            >
              <Badge tone="good">
                {MODELS[resident].label}
                {device ? ` · ${device === 'webgpu' ? 'GPU' : 'CPU'}` : ''}
                {dtype ? ` · ${dtype}` : ''}
              </Badge>
            </button>
          ) : (
            <button onClick={() => setShowModels(true)} className="rounded hover:opacity-80">
              <Badge tone="warn">no model loaded</Badge>
            </button>
          )}
          {running > 0 && <Badge tone="accent">generating</Badge>}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="mr-1 flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={!canUndo}
              onClick={undo}
              title={`Undo  (${keys.undo})`}
              aria-label="Undo"
            >
              ↶
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canRedo}
              onClick={redo}
              title={`Redo  (${keys.redo})`}
              aria-label="Redo"
            >
              ↷
            </Button>
          </div>

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

          <Button
            size="sm"
            variant={resident ? 'ghost' : 'primary'}
            disabled={Boolean(loading)}
            onClick={() => setShowModels(true)}
          >
            {loading ? 'Downloading…' : 'Models'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              resetToStarter()
              setNotice({ kind: 'info', text: 'Starter canvas restored.' })
            }}
            title="Reload the starter prompts"
          >
            Reset
          </Button>
        </div>
      </header>

      {showModels && <ModelPicker onClose={() => setShowModels(false)} />}
    </>
  )
}
