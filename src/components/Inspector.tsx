import { useMemo, useState } from 'react'
import { composePrompt } from '../lib/compose'
import {
  MODELS,
  MODEL_IDS,
  contextPressure,
  estimateTokens,
  formatDuration,
  formatMb,
  formatTokens,
} from '../lib/models'
import { useCanvas } from '../store/useCanvas'
import type { ContextBlock, ModelId } from '../types'
import { Badge, Button, Field, Input, Label, Select } from './ui'

const KINDS: Array<{ value: ContextBlock['kind']; label: string }> = [
  { value: 'context', label: 'context' },
  { value: 'correction', label: 'trace correction' },
  { value: 'example', label: 'example' },
]

export function Inspector() {
  const canvas = useCanvas((s) => s.canvas)
  const selectedId = useCanvas((s) => s.selectedId)
  const update = useCanvas((s) => s.updateNodeData)
  const addBlock = useCanvas((s) => s.addBlock)
  const updateBlock = useCanvas((s) => s.updateBlock)
  const removeBlock = useCanvas((s) => s.removeBlock)
  const runNode = useCanvas((s) => s.runNode)
  const cancelNode = useCanvas((s) => s.cancelNode)
  const clearRuns = useCanvas((s) => s.clearRuns)
  const deleteNode = useCanvas((s) => s.deleteNode)
  const addBranch = useCanvas((s) => s.addBranch)

  const [tab, setTab] = useState<'prompt' | 'output' | 'composed'>('prompt')

  const node = canvas.nodes.find((n) => n.id === selectedId)
  const composed = useMemo(() => (node ? composePrompt(canvas, node.id) : null), [canvas, node])

  if (!node || !composed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[var(--color-muted)]">
        Select a node to edit its prompt.
      </div>
    )
  }

  const isRoot = node.id === canvas.rootId
  const streaming = node.data.runs.some(
    (r) => r.status === 'streaming' || r.status === 'loading',
  )
  const inherited = composed.blocks.filter((b) => b.inherited)
  const spec = MODELS[node.data.model]

  const promptTokens = estimateTokens(composed.text) + estimateTokens(composed.system)
  const pressure = contextPressure(node.data.model, promptTokens, node.data.maxNewTokens)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-edge)] px-4 py-3">
        <Input
          value={node.data.title}
          onChange={(v) => update(node.id, { title: v })}
          placeholder="Node title"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isRoot && <Badge tone="accent">root</Badge>}
          {node.data.mergedFrom && <Badge tone="accent">merged</Badge>}
          <Badge>{spec.label}</Badge>
          <span className="ml-auto text-[11px] text-[var(--color-muted)]">
            ~{formatTokens(promptTokens)} tok
          </span>
        </div>
      </div>

      <div className="flex border-b border-[var(--color-edge)] px-2 text-[12px]">
        {(['prompt', 'output', 'composed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 capitalize ${
              tab === t
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-ink)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {t === 'output' ? `output (${node.data.runs.length})` : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'prompt' && (
          <div className="space-y-4">
            {isRoot && (
              <div>
                <Label>System prompt — inherited by every branch</Label>
                <Field
                  value={node.data.system ?? ''}
                  onChange={(v) => update(node.id, { system: v })}
                  placeholder="You are…"
                  rows={3}
                />
              </div>
            )}

            {inherited.length > 0 && (
              <div>
                <Label>Inherited from ancestors ({inherited.length})</Label>
                <div className="space-y-1">
                  {inherited.map((b) => (
                    <div
                      key={`${b.fromNodeId}-${b.id}`}
                      className="flex items-center gap-2 rounded border border-[var(--color-edge)] bg-[var(--color-canvas)] px-2 py-1.5 text-[12px] text-[var(--color-muted)]"
                    >
                      <span className="shrink-0">{b.kind === 'correction' ? '⤷' : '·'}</span>
                      <span className="truncate">{b.label || b.kind}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-[#5a6175]">
                        {formatTokens(estimateTokens(b.text))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label>This node&apos;s blocks</Label>
                <Button size="sm" variant="ghost" onClick={() => addBlock(node.id)}>
                  + block
                </Button>
              </div>
              <div className="space-y-3">
                {node.data.blocks.length === 0 && (
                  <p className="text-[12px] text-[#5a6175]">
                    No blocks. Add a trace correction to make this branch differ from its parent.
                  </p>
                )}
                {node.data.blocks.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-md border border-[var(--color-edge)] bg-[var(--color-canvas)]/40 p-2"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={b.enabled}
                        onChange={(e) => updateBlock(node.id, b.id, { enabled: e.target.checked })}
                        title="Include in the prompt"
                        className="accent-[var(--color-accent)]"
                      />
                      <input
                        value={b.label}
                        onChange={(e) => updateBlock(node.id, b.id, { label: e.target.value })}
                        placeholder="label"
                        className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-ink)] focus:outline-none"
                      />
                      <select
                        value={b.kind}
                        onChange={(e) =>
                          updateBlock(node.id, b.id, {
                            kind: e.target.value as ContextBlock['kind'],
                          })
                        }
                        className="rounded border border-[var(--color-edge)] bg-[var(--color-canvas)] px-1 py-0.5 text-[11px]"
                      >
                        {KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeBlock(node.id, b.id)}
                        className="px-1 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                        title="Remove block"
                      >
                        ✕
                      </button>
                    </div>
                    <Field
                      value={b.text}
                      onChange={(v) => updateBlock(node.id, b.id, { text: v })}
                      placeholder={
                        b.kind === 'correction'
                          ? 'What the previous output got wrong, and what to do instead…'
                          : 'Context…'
                      }
                      rows={b.kind === 'correction' ? 4 : 3}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Instruction {isRoot ? '' : '(overrides inherited)'}</Label>
              <Field
                value={node.data.instruction ?? ''}
                onChange={(v) => update(node.id, { instruction: v })}
                placeholder={composed.instruction || 'What should the model do?'}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Model</Label>
                <Select<ModelId>
                  value={node.data.model}
                  onChange={(v) => update(node.id, { model: v })}
                  options={MODEL_IDS.map((m) => ({
                    value: m,
                    label: `${MODELS[m].label} — ${MODELS[m].size}`,
                  }))}
                />
              </div>
              <div>
                <Label>Max new tokens</Label>
                <Input
                  value={String(node.data.maxNewTokens)}
                  onChange={(v) =>
                    update(node.id, { maxNewTokens: Math.max(16, Number(v) || 256) })
                  }
                />
              </div>
            </div>

            <p className="-mt-2 text-[11px] leading-relaxed text-[#5a6175]">
              {formatMb(spec.downloadMb)} download, once · {formatTokens(spec.contextTokens)} token
              context. {spec.caveat}
            </p>

            {/* Context is the binding constraint here, not money. */}
            <div
              className={`rounded-md border px-2.5 py-2 text-[11px] leading-relaxed ${
                pressure.level === 'over'
                  ? 'border-[var(--color-danger)]/50 bg-[#3a1f22]/40 text-[var(--color-danger)]'
                  : pressure.level === 'tight'
                    ? 'border-[var(--color-warn)]/50 bg-[#3a3218]/40 text-[var(--color-warn)]'
                    : 'border-[var(--color-edge)] text-[var(--color-muted)]'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span>Context budget</span>
                <span>
                  ~{formatTokens(pressure.used)} / {formatTokens(pressure.limit)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded bg-[var(--color-edge)]">
                <div
                  className={`h-full ${
                    pressure.level === 'over'
                      ? 'bg-[var(--color-danger)]'
                      : pressure.level === 'tight'
                        ? 'bg-[var(--color-warn)]'
                        : 'bg-[var(--color-accent)]'
                  }`}
                  style={{ width: `${Math.min(100, pressure.ratio * 100)}%` }}
                />
              </div>
              {pressure.level === 'over' && (
                <p className="mt-1">
                  Prompt plus max new tokens exceeds the window. The model will silently see a
                  truncated prompt. Disable a context block, shorten the ancestry, lower max new
                  tokens, or switch to a model with a larger window.
                </p>
              )}
              {pressure.level === 'tight' && (
                <p className="mt-1">
                  Close to the limit. Branching further down this lineage will overflow it.
                </p>
              )}
            </div>

            {!isRoot && (
              <Button variant="danger" size="sm" onClick={() => deleteNode(node.id)}>
                Delete node
              </Button>
            )}
          </div>
        )}

        {tab === 'composed' && (
          <div className="space-y-3">
            {composed.system && (
              <div>
                <Label>System</Label>
                <pre className="whitespace-pre-wrap rounded bg-[var(--color-canvas)] p-2.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                  {composed.system}
                </pre>
              </div>
            )}
            <div>
              <Label>User turn — what actually gets sent</Label>
              <pre className="whitespace-pre-wrap rounded bg-[var(--color-canvas)] p-2.5 text-[12px] leading-relaxed">
                {composed.text || '(empty)'}
              </pre>
            </div>
          </div>
        )}

        {tab === 'output' && (
          <div className="space-y-3">
            {node.data.runs.length === 0 && (
              <p className="text-[12px] text-[#5a6175]">
                No samples yet. Run this node to generate one.
              </p>
            )}
            {node.data.runs.map((r, i) => (
              <div key={r.id} className="rounded-md border border-[var(--color-edge)]">
                <div className="flex items-center gap-2 border-b border-[var(--color-edge)] px-2.5 py-1.5 text-[11px] text-[var(--color-muted)]">
                  <span>sample {i + 1}</span>
                  {r.status === 'loading' && <Badge tone="accent">loading model</Badge>}
                  {r.status === 'streaming' && <Badge tone="accent">generating</Badge>}
                  {r.status === 'error' && <Badge tone="danger">error</Badge>}
                  {r.status === 'cancelled' && <Badge>stopped</Badge>}
                  {r.stats && (
                    <span className="ml-auto flex items-center gap-2">
                      <span>{formatTokens(r.stats.completionTokens)} tok</span>
                      <span>{r.stats.tokensPerSecond.toFixed(1)}/s</span>
                      <span>{formatDuration(r.stats.elapsedMs)}</span>
                    </span>
                  )}
                </div>
                {r.error ? (
                  <p className="whitespace-pre-wrap px-2.5 py-2 text-[12px] leading-relaxed text-[var(--color-danger)]">
                    {r.error}
                  </p>
                ) : (
                  <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap px-2.5 py-2 text-[12px] leading-relaxed">
                    {r.text || (r.status === 'done' ? '(empty)' : '…')}
                  </pre>
                )}
              </div>
            ))}
            {node.data.runs.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => clearRuns(node.id)}>
                Clear samples
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-edge)] p-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => addBranch(node.id)}>
            Branch
          </Button>
          {streaming ? (
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              onClick={() => cancelNode(node.id)}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              disabled={pressure.level === 'over'}
              title={
                pressure.level === 'over' ? 'Prompt exceeds the model context window' : undefined
              }
              onClick={() => void runNode(node.id, 1)}
            >
              Run
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
