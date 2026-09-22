import { useEffect, useState } from 'react'
import {
  cacheUsage,
  currentDevice,
  deleteModel,
  downloadedModels,
  loadedModel,
  storageEstimate,
} from '../lib/engine'
import { formatError } from '../lib/errors'
import { MODELS, MODEL_IDS, formatMb, formatTokens, type ModelId } from '../lib/models'
import { useCanvas } from '../store/useCanvas'
import { Badge, Button, Modal } from './ui'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`
  return `${(bytes / 1e9).toFixed(1)} GB`
}

/**
 * Model download, selection and removal.
 *
 * Doubles as the first-run screen and the ongoing manager, because they are the
 * same decision made at different times: which weights do you want on this
 * machine. Sizes shown for a downloaded model are what is actually cached,
 * measured rather than estimated, so "free 271 MB" means that number.
 */
export function ModelPicker({
  onClose,
  firstRun = false,
}: {
  onClose: () => void
  firstRun?: boolean
}) {
  const ensureModel = useCanvas((s) => s.ensureModel)
  const setNotice = useCanvas((s) => s.setNotice)
  const canvas = useCanvas((s) => s.canvas)
  const updateNodeData = useCanvas((s) => s.updateNodeData)
  const loading = useCanvas((s) => s.loading)
  const setActiveModel = useCanvas((s) => s.setActiveModel)

  const [resident, setResident] = useState<ModelId | null>(loadedModel())
  const [downloaded, setDownloaded] = useState<ModelId[]>(downloadedModels())
  const [usage, setUsage] = useState<Partial<Record<ModelId, number>>>({})
  const [total, setTotal] = useState<{ usage: number; quota: number } | null>(null)
  const [pending, setPending] = useState<ModelId | null>(null)
  const [confirming, setConfirming] = useState<ModelId | null>(null)
  const [deleting, setDeleting] = useState<ModelId | null>(null)

  const refresh = () => {
    setResident(loadedModel())
    setDownloaded(downloadedModels())
    void cacheUsage().then(setUsage)
    void storageEstimate().then(setTotal)
  }

  useEffect(refresh, [])

  const choose = async (id: ModelId) => {
    setPending(id)
    const ok = await ensureModel(id)
    setPending(null)
    if (!ok) return

    // Point every node at what was just loaded, so the change is felt straight
    // away rather than needing a per-node edit.
    for (const n of canvas.nodes) {
      if (n.data.model !== id) updateNodeData(n.id, { model: id })
    }
    refresh()
    setNotice({
      kind: 'info',
      text: `${MODELS[id].label} is ready, running on ${
        currentDevice() === 'webgpu' ? 'your GPU' : 'CPU'
      }. Nothing leaves this machine.`,
    })
    onClose()
  }

  const remove = async (id: ModelId) => {
    setConfirming(null)
    setDeleting(id)
    try {
      const freed = await deleteModel(id)
      // The toolbar badge reads this; leaving it set would advertise a model
      // whose weights are gone.
      setActiveModel(loadedModel())
      refresh()
      setNotice({
        kind: 'info',
        text: `Deleted ${MODELS[id].label}${
          freed > 0 ? `, freeing ${formatBytes(freed)}` : ''
        }. Downloading it again restores it.`,
      })
    } catch (err) {
      setNotice({ kind: 'error', text: formatError(err) })
    } finally {
      setDeleting(null)
    }
  }

  return (
    <Modal title={firstRun ? 'Pick a model to get started' : 'Models'} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed">
          Models run entirely in this browser. Weights are downloaded once from Hugging Face and
          cached, so there is no account, no API key and no cost — and after the first download it
          works offline. Your prompts never leave the machine.
        </p>

        <div className="space-y-2">
          {MODEL_IDS.map((id) => {
            const spec = MODELS[id]
            const here = downloaded.includes(id)
            const active = resident === id
            const cached = usage[id] ?? 0
            const busy = pending === id
            const isDeleting = deleting === id
            const bar = loading?.modelId === id ? loading : null

            return (
              <div
                key={id}
                className={`rounded-md border p-3 ${
                  active
                    ? 'border-[var(--color-good)]/50 bg-[#16332a]/20'
                    : 'border-[var(--color-edge)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{spec.label}</span>
                  <span className="font-mono text-[11px] text-[var(--color-accent)]">
                    {spec.size}
                  </span>
                  {active && <Badge tone="good">loaded</Badge>}
                  {!active && here && <Badge>on disk</Badge>}
                  <span className="ml-auto text-[11px] text-[var(--color-muted)]">
                    {here && cached > 0 ? formatBytes(cached) : formatMb(spec.downloadMb)} ·{' '}
                    {formatTokens(spec.contextTokens)} ctx
                  </span>
                </div>

                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                  {spec.caveat}
                </p>

                {/* Progress belongs on the row being downloaded, not in a
                    detached bar that this modal covers up. */}
                {bar && (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                      <span>
                        {bar.verifying
                          ? 'Checking this variant runs here'
                          : bar.fromCache
                            ? 'Loading from cache'
                            : bar.progress > 0
                              ? 'Downloading weights'
                              : 'Contacting Hugging Face'}
                        {bar.dtype ? ` · ${bar.dtype}` : ''}
                        {bar.device === 'wasm' ? ' · CPU' : bar.device === 'webgpu' ? ' · GPU' : ''}
                      </span>
                      <span className="font-mono">
                        {bar.totalBytes
                          ? `${formatBytes(bar.loadedBytes ?? 0)} / ${formatBytes(bar.totalBytes)}`
                          : `${Math.round(bar.progress * 100)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded bg-[var(--color-edge)]">
                      <div
                        className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
                        style={{ width: `${Math.max(2, bar.progress * 100)}%` }}
                      />
                    </div>
                    {bar.file && (
                      <p className="mt-1 truncate font-mono text-[10px] text-[#5a6175]">
                        {bar.file}
                      </p>
                    )}
                  </div>
                )}

                {confirming === id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-[var(--color-warn)]">
                      Delete {cached > 0 ? formatBytes(cached) : formatMb(spec.downloadMb)} of
                      weights?
                      {active ? ' This model is currently in use.' : ''}
                    </span>
                    <Button size="sm" variant="danger" onClick={() => void remove(id)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={active ? 'ghost' : 'primary'}
                      disabled={active || Boolean(pending) || Boolean(deleting)}
                      onClick={() => void choose(id)}
                    >
                      {active
                        ? 'In use'
                        : busy
                          ? here
                            ? 'Loading…'
                            : 'Downloading…'
                          : here
                            ? 'Use this one'
                            : `Download ${formatMb(spec.downloadMb)}`}
                    </Button>
                    {here && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={Boolean(pending) || Boolean(deleting)}
                        onClick={() => setConfirming(id)}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </Button>
                    )}
                    <a
                      href={`https://huggingface.co/${id}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto text-[11px] text-[var(--color-muted)] underline hover:text-[var(--color-ink)]"
                    >
                      model card
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="rounded-md border border-[var(--color-edge)] bg-[var(--color-canvas)] p-3">
          <p className="text-[12px] font-semibold">These are small models</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            Even the largest here is a fraction of the size of a hosted frontier model, and none of
            them will write you a polished answer. What they will do is react sharply to how a
            prompt is worded, which is the thing this tool is built to show. Start with 135M to see
            the workflow quickly; move up to 1.7B when you want output worth reading.
          </p>
          {total && (
            <p className="mt-2 text-[11px] text-[#5a6175]">
              This site is using {formatBytes(total.usage)}
              {total.quota > 0 ? ` of roughly ${formatBytes(total.quota)} available` : ''}. Model
              weights and saved canvases share that budget.
            </p>
          )}
        </div>

        {!firstRun && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
