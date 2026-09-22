import { useEffect, useMemo, useRef, useState } from 'react'
import { composePrompt } from '../lib/compose'
import { presetsWithin } from '../lib/number'
import { isRunOpen, orderRunsNewestFirst, runPreview } from '../lib/runs'
import { readPref, writePref } from '../lib/prefs'
import {
  MODELS,
  MODEL_IDS,
  contextPressure,
  effectiveMaxNewTokens,
  estimateTokens,
  modelMaxNewTokens,
  formatDuration,
  formatMb,
  formatTokens,
} from '../lib/models'
import { useCanvas } from '../store/useCanvas'
import { Markdown } from './Markdown'
import { MarkdownEditor } from './MarkdownEditor'
import type { ContextBlock, ModelId } from '../types'
import { Badge, Button, Input, Label, NumberField, Segmented, Select } from './ui'

/** How the Composed tab was last read. Remembered, since it is a reading habit. */
const ADVANCED_KEY = 'promptcanvas.advancedOpen'
const COMPOSED_VIEW_KEY = 'promptcanvas.composedView'
const COMPOSED_VIEWS = ['raw', 'rendered'] as const
type ComposedView = (typeof COMPOSED_VIEWS)[number]

/** One-click lengths, filtered to what the chosen model can actually hold. */
const TOKEN_PRESETS = [128, 256, 512, 1024, 2048] as const

/** Enough to be a real answer; below this the model is cut off mid-sentence. */
const MIN_NEW_TOKENS = 16

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

  const [tab, setTab] = useState<'output' | 'prompt' | 'composed'>('output')
  const [copied, setCopied] = useState<string | null>(null)
  const [composedView, setComposedView] = useState<ComposedView>(() =>
    readPref(COMPOSED_VIEW_KEY, COMPOSED_VIEWS, 'raw'),
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [runOverrides, setRunOverrides] = useState<Record<string, boolean>>({})
  const [advancedOpen, setAdvancedOpen] = useState(
    () => readPref(ADVANCED_KEY, ['open', 'closed'] as const, 'closed') === 'open',
  )
  const lastNode = useRef<string | null>(null)

  const node = canvas.nodes.find((n) => n.id === selectedId)
  const composed = useMemo(() => (node ? composePrompt(canvas, node.id) : null), [canvas, node])

  /**
   * Land on whatever the node actually has to show.
   *
   * Only on *selection change*, never on re-render: yanking the panel to output
   * mid-sentence because a stream arrived would be worse than a stale tab.
   */
  useEffect(() => {
    if (!selectedId || selectedId === lastNode.current) return
    lastNode.current = selectedId
    setConfirmDelete(false)
    setRunOverrides({})
    const n = canvas.nodes.find((x) => x.id === selectedId)
    setTab(n && n.data.runs.length > 0 ? 'output' : 'prompt')
  }, [selectedId, canvas.nodes])

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
    } catch {
      // Clipboard access can be denied; the text is selectable either way.
    }
  }

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
  const childCount = canvas.edges.filter((e) => e.source === node.id).length
  const spec = MODELS[node.data.model]

  const promptTokens = estimateTokens(composed.text) + estimateTokens(composed.system)
  const isAuto = node.data.maxNewTokens === 'auto'
  const newTokens = effectiveMaxNewTokens(
    node.data.model,
    promptTokens,
    node.data.maxNewTokens,
    MIN_NEW_TOKENS,
  )
  const pressure = contextPressure(node.data.model, promptTokens, newTokens)

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
        {(['output', 'prompt', 'composed'] as const).map((t) => (
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
                <MarkdownEditor
                  value={node.data.system ?? ''}
                  onChange={(v) => update(node.id, { system: v })}
                  placeholder="You are…"
                  rows={6}
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
                    <MarkdownEditor
                      value={b.text}
                      onChange={(v) => updateBlock(node.id, b.id, { text: v })}
                      placeholder={
                        b.kind === 'correction'
                          ? 'What the previous output got wrong, and what to do instead…'
                          : 'Context…'
                      }
                      rows={b.kind === 'correction' ? 10 : 8}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Instruction {isRoot ? '' : '(overrides inherited)'}</Label>
              <MarkdownEditor
                value={node.data.instruction ?? ''}
                onChange={(v) => update(node.id, { instruction: v })}
                placeholder={composed.instruction || 'What should the model do?'}
                rows={5}
              />
            </div>

            {/* Everything here is a default that rarely needs touching, so it
                stays folded away rather than competing with the prompt. */}
            <div className="rounded-md border border-[var(--color-edge)]">
              <button
                onClick={() => {
                  const next = !advancedOpen
                  setAdvancedOpen(next)
                  writePref(ADVANCED_KEY, next ? 'open' : 'closed')
                }}
                className="flex w-full items-center gap-1.5 px-2.5 py-2 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <span className="font-mono text-[10px]">{advancedOpen ? 'v' : '>'}</span>
                <span>Advanced settings</span>
                <span className="ml-auto truncate text-[10.5px] text-[#5a6175]">
                  {spec.label} &middot; {isAuto ? 'auto length' : `${formatTokens(newTokens)} max`}
                </span>
              </button>

              {advancedOpen && (
                <div className="space-y-3 border-t border-[var(--color-edge)] p-2.5">
                  <div>
                    <Label>Model</Label>
                    <Select<ModelId>
                      value={node.data.model}
                      onChange={(v) => update(node.id, { model: v })}
                      options={MODEL_IDS.map((m) => ({
                        value: m,
                        label: `${MODELS[m].label} - ${MODELS[m].size}`,
                      }))}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-[#5a6175]">
                      {formatMb(spec.downloadMb)} download, once &middot;{' '}
                      {formatTokens(spec.contextTokens)} token context. {spec.caveat}
                    </p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Label>Response length</Label>
                      <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                        <input
                          type="checkbox"
                          checked={isAuto}
                          onChange={(e) =>
                            update(node.id, {
                              maxNewTokens: e.target.checked
                                ? 'auto'
                                : modelMaxNewTokens(node.data.model),
                            })
                          }
                          className="accent-[var(--color-accent)]"
                        />
                        auto
                      </label>
                    </div>

                    {isAuto ? (
                      <p className="text-[11.5px] leading-relaxed text-[var(--color-muted)]">
                        This model&apos;s maximum is{' '}
                        {formatTokens(modelMaxNewTokens(node.data.model))} tokens, shared with
                        the prompt — so about {formatTokens(newTokens)} here, and less as this
                        branch grows. Worked out from the real token count when the node runs,
                        not from this estimate.
                      </p>
                    ) : (
                      <>
                        <NumberField
                          value={newTokens}
                          onChange={(v) => update(node.id, { maxNewTokens: v })}
                          min={MIN_NEW_TOKENS}
                          max={spec.contextTokens}
                          step={64}
                          suffix="tok"
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {presetsWithin(TOKEN_PRESETS, MIN_NEW_TOKENS, spec.contextTokens).map(
                            (preset) => (
                              <button
                                key={preset}
                                onClick={() => update(node.id, { maxNewTokens: preset })}
                                className={`rounded px-1.5 py-0.5 text-[11px] ${
                                  node.data.maxNewTokens === preset
                                    ? 'bg-[var(--color-accent)] text-[#0b0d12]'
                                    : 'text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]'
                                }`}
                              >
                                {preset}
                              </button>
                            ),
                          )}
                        </div>
                        {typeof node.data.maxNewTokens === 'number' &&
                          newTokens < node.data.maxNewTokens && (
                            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-warn)]">
                              Reduced to {formatTokens(newTokens)} to fit alongside the prompt.
                              Your cap of {formatTokens(node.data.maxNewTokens)} applies again
                              on a shorter branch.
                            </p>
                          )}
                      </>
                    )}
                  </div>

                  {/* Broken into its parts. One combined number reads as though
                      the app mangled your figure, because it quietly folds in
                      the prompt as well. */}
                  <div
                    className={`rounded-md border px-2.5 py-2 text-[11px] leading-relaxed ${
                      pressure.level === 'over'
                        ? 'border-[var(--color-danger)]/50 bg-[#3a1f22]/40 text-[var(--color-danger)]'
                        : pressure.level === 'tight'
                          ? 'border-[var(--color-warn)]/50 bg-[#3a3218]/40 text-[var(--color-warn)]'
                          : 'border-[var(--color-edge)] text-[var(--color-muted)]'
                    }`}
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span>Context window</span>
                      <span className="font-mono text-[10.5px]">
                        {formatTokens(pressure.used)} / {formatTokens(pressure.limit)}
                      </span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded bg-[var(--color-edge)]">
                      <div
                        className="h-full bg-[var(--color-muted)]"
                        style={{
                          width: `${Math.min(100, (promptTokens / pressure.limit) * 100)}%`,
                        }}
                      />
                      <div
                        className={`h-full ${
                          pressure.level === 'over'
                            ? 'bg-[var(--color-danger)]'
                            : 'bg-[var(--color-accent)]'
                        }`}
                        style={{
                          width: `${Math.min(
                            Math.max(0, 100 - (promptTokens / pressure.limit) * 100),
                            (newTokens / pressure.limit) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
                      <span>
                        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--color-muted)] align-middle" />
                        ~{formatTokens(promptTokens)} prompt
                      </span>
                      <span>
                        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--color-accent)] align-middle" />
                        {formatTokens(newTokens)} response
                      </span>
                    </div>
                    {pressure.level === 'over' && (
                      <p className="mt-1.5">
                        Over the window, so the model would see a truncated prompt. Disable a
                        context block, shorten the ancestry, or move to a model with a larger
                        window.
                      </p>
                    )}
                    {pressure.level === 'tight' && !isAuto && (
                      <p className="mt-1.5">
                        Close to the limit. Switching response length back to auto keeps this in
                        range as the branch grows.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'composed' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {/* Raw leads, because this tab's job is to show exactly what will
                  be sent. Rendered is for judging whether the markdown you
                  wrote is well-formed before spending a generation on it. */}
              <Segmented
                value={composedView}
                onChange={(v) => {
                  setComposedView(v)
                  writePref(COMPOSED_VIEW_KEY, v)
                }}
                options={[
                  { value: 'raw', label: 'raw' },
                  { value: 'rendered', label: 'rendered' },
                ]}
              />
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  void copy(
                    'composed',
                    [composed.system, composed.text].filter(Boolean).join(`\n\n`),
                  )
                }
              >
                {copied === 'composed' ? 'copied' : 'copy all'}
              </Button>
            </div>

            {composed.system && (
              <div>
                <Label>System</Label>
                {composedView === 'raw' ? (
                  <pre className="whitespace-pre-wrap rounded bg-[var(--color-canvas)] p-2.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                    {composed.system}
                  </pre>
                ) : (
                  <div className="rounded bg-[var(--color-canvas)] p-2.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                    <Markdown>{composed.system}</Markdown>
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>
                {composedView === 'raw'
                  ? 'User turn — what actually gets sent, verbatim'
                  : 'User turn — how the markdown reads'}
              </Label>
              {composedView === 'raw' ? (
                <pre className="whitespace-pre-wrap rounded bg-[var(--color-canvas)] p-2.5 text-[12px] leading-relaxed">
                  {composed.text || '(empty)'}
                </pre>
              ) : (
                <div className="rounded bg-[var(--color-canvas)] p-2.5 text-[12.5px] leading-relaxed text-[var(--color-ink)]">
                  {composed.text ? <Markdown>{composed.text}</Markdown> : '(empty)'}
                </div>
              )}
            </div>

            {composedView === 'rendered' && (
              <p className="text-[11px] leading-relaxed text-[#5a6175]">
                The model receives the raw text, not this. Rendering it only shows whether the
                markdown is well-formed.
              </p>
            )}
          </div>
        )}

        {tab === 'output' && (
          <div className="space-y-3">
            {node.data.runs.length === 0 && (
              <div className="rounded-md border border-dashed border-[var(--color-edge)] px-4 py-10 text-center">
                <p className="text-[13px] text-[var(--color-muted)]">Nothing generated yet.</p>
                <p className="mt-1 text-[12px] text-[#5a6175]">
                  Run this node to see what the prompt produces.
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-3"
                  disabled={pressure.level === 'over'}
                  onClick={() => void runNode(node.id, 1)}
                >
                  Run
                </Button>
              </div>
            )}

            {(() => {
              const ordered = orderRunsNewestFirst(node.data.runs)
              const newestId = ordered[0]?.run.id
              return ordered.map(({ run: r, number }) => {
                const open = isRunOpen(r, r.id === newestId, runOverrides)
                return (
                  <div key={r.id} className="rounded-md border border-[var(--color-edge)]">
                    <button
                      onClick={() => setRunOverrides((o) => ({ ...o, [r.id]: !open }))}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      aria-expanded={open}
                    >
                      <span className="font-mono text-[10px]">{open ? 'v' : '>'}</span>
                      <span>run {number}</span>
                      {r.status === 'loading' && <Badge tone="accent">loading model</Badge>}
                      {r.status === 'streaming' && <Badge tone="accent">generating</Badge>}
                      {r.status === 'error' && <Badge tone="danger">error</Badge>}
                      {r.status === 'cancelled' && <Badge>stopped</Badge>}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {r.stats && (
                          <>
                            <span>{formatTokens(r.stats.completionTokens)} tok</span>
                            <span>{r.stats.tokensPerSecond.toFixed(1)}/s</span>
                            <span>{formatDuration(r.stats.elapsedMs)}</span>
                          </>
                        )}
                      </span>
                    </button>

                    {open ? (
                      <div className="border-t border-[var(--color-edge)]">
                        <div className="flex items-center justify-end px-2.5 pt-1.5">
                          {r.text && (
                            <button
                              onClick={() => void copy(r.id, r.text)}
                              className="rounded px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]"
                            >
                              {copied === r.id ? 'copied' : 'copy'}
                            </button>
                          )}
                        </div>
                        {r.error ? (
                          <p className="whitespace-pre-wrap px-3 pb-2.5 text-[12px] leading-relaxed text-[var(--color-danger)]">
                            {r.error}
                          </p>
                        ) : (
                          <div className="px-3 pb-2.5 text-[13px] leading-[1.65] text-[var(--color-ink)]">
                            {r.text ? (
                              <Markdown>{r.text}</Markdown>
                            ) : (
                              <span className="text-[var(--color-muted)]">
                                {r.status === 'done'
                                  ? '(empty response)'
                                  : 'waiting for the first token...'}
                              </span>
                            )}
                            {r.status === 'streaming' && (
                              <span className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-[var(--color-accent)]" />
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Collapsed rows still need to be told apart, so each one
                         keeps a single line of what it produced. */
                      <button
                        onClick={() => setRunOverrides((o) => ({ ...o, [r.id]: true }))}
                        className={`block w-full truncate border-t border-[var(--color-edge)] px-3 py-1.5 text-left text-[11.5px] ${
                          r.error ? 'text-[var(--color-danger)]/70' : 'text-[#5a6175]'
                        }`}
                      >
                        {runPreview(r)}
                      </button>
                    )}
                  </div>
                )
              })
            })()}

            {node.data.runs.length > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => clearRuns(node.id)}>
                  Clear runs
                </Button>
                {node.data.runs.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRunOverrides((o) => {
                        const anyClosed = node.data.runs.some(
                          (r, i) => !isRunOpen(r, i === node.data.runs.length - 1, o),
                        )
                        return Object.fromEntries(
                          node.data.runs.map((r) => [r.id, anyClosed]),
                        )
                      })
                    }
                  >
                    Expand / collapse all
                  </Button>
                )}
                <span className="text-[11px] text-[#5a6175]">
                  Generation is greedy, so an unchanged prompt returns identical text.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-edge)] p-3">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12px] leading-snug text-[var(--color-warn)]">
              Delete &ldquo;{node.data.title}&rdquo;?
              {childCount > 0 &&
                ` Its ${childCount === 1 ? 'child' : `${childCount} children`} will reconnect to its parent.`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmDelete(false)
                deleteNode(node.id)
              }}
            >
              Delete
            </Button>
          </div>
        ) : (
        <div className="flex items-center gap-2">
          {!isRoot && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
              title="Delete this node"
            >
              Delete
            </Button>
          )}
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
        )}
      </div>
    </div>
  )
}
