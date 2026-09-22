import { useState } from 'react'
import { currentDevice, isDownloaded, loadedModel } from '../lib/engine'
import { MODELS, MODEL_IDS, formatMb, formatTokens, type ModelId } from '../lib/models'
import { useCanvas } from '../store/useCanvas'
import { Badge, Button, Modal } from './ui'

/**
 * Model download and selection.
 *
 * Doubles as the first-run screen and the "Models" manager, because they are the
 * same decision made at different times: which weights do you want on this
 * machine. Download state is per browser, so the list says what is already here
 * rather than presenting three equal-looking options.
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

  const resident = loadedModel()
  const [pending, setPending] = useState<ModelId | null>(null)

  const choose = async (id: ModelId) => {
    setPending(id)
    const ok = await ensureModel(id)
    setPending(null)
    if (!ok) return

    // Point every node that still uses the old default at what was just loaded,
    // so the user does not have to change it node by node to feel the effect.
    for (const n of canvas.nodes) {
      if (n.data.model !== id) updateNodeData(n.id, { model: id })
    }

    setNotice({
      kind: 'info',
      text: `${MODELS[id].label} is ready, running on ${
        currentDevice() === 'webgpu' ? 'your GPU' : 'CPU'
      }. Nothing leaves this machine.`,
    })
    onClose()
  }

  return (
    <Modal
      title={firstRun ? 'Pick a model to get started' : 'Models'}
      onClose={onClose}
      wide
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed">
          Models run entirely in this browser. Weights are downloaded once from Hugging Face and
          cached, so there is no account, no API key and no cost — and after the first download it
          works offline. Your prompts never leave the machine.
        </p>

        <div className="space-y-2">
          {MODEL_IDS.map((id) => {
            const spec = MODELS[id]
            const here = isDownloaded(id)
            const active = resident === id
            const busy = pending === id

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
                  {!active && here && <Badge>downloaded</Badge>}
                  <span className="ml-auto text-[11px] text-[var(--color-muted)]">
                    {here ? 'cached' : formatMb(spec.downloadMb)} ·{' '}
                    {formatTokens(spec.contextTokens)} ctx
                  </span>
                </div>

                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                  {spec.caveat}
                </p>

                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={active ? 'ghost' : 'primary'}
                    disabled={active || Boolean(pending) || Boolean(loading)}
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
                  <a
                    href={`https://huggingface.co/${id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[11px] text-[var(--color-muted)] underline hover:text-[var(--color-ink)]"
                  >
                    model card
                  </a>
                </div>
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
