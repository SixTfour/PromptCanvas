import { useMemo, useState } from 'react'
import { composePrompt } from '../lib/compose'
import {
  type DiffRow,
  type InlineChunk,
  alignPhrases,
  alignRows,
  assemble,
  buildSynthesisPrompt,
  countChanges,
  inlineDiff,
} from '../lib/diff'
import { generate } from '../lib/engine'
import { formatError } from '../lib/errors'
import { carriedContext, correctionText } from '../lib/merge'
import { MODELS, specFor, type ModelId } from '../lib/models'
import { useCanvas } from '../store/useCanvas'
import { MarkdownEditor } from './MarkdownEditor'
import { Badge, Button, Modal, Segmented } from './ui'

/**
 * Diff & Merge.
 *
 * Two ways to build the merged prompt, side by side because they suit different
 * moments:
 *
 *   - **Pick phrases** is deterministic and exact. Phrases shared by both
 *     branches are selected by default; the contested ones are yours to choose.
 *   - **Synthesise with the model** hands both prompts and both outputs to the
 *     local model and asks for a single stronger prompt. On a small model this
 *     is the weaker path; picking phrases is the reliable one.
 *
 * Whichever you use, the result becomes a *new* node with edges from both
 * parents. Nothing is re-parented and no history is destroyed.
 *
 * The exception is a rebuild. When `targetId` names an existing merge — one
 * whose branches have changed underneath it — the result overwrites that node
 * instead of adding a second one beside it. Same decision, newer information,
 * same place in the graph.
 */
export function DiffMerge({
  aId,
  bId,
  targetId,
  onClose,
}: {
  aId: string
  bId: string
  targetId?: string | null
  onClose: () => void
}) {
  const canvas = useCanvas((s) => s.canvas)
  const addMergeNode = useCanvas((s) => s.addMergeNode)
  const replaceMergeNode = useCanvas((s) => s.replaceMergeNode)
  const setNotice = useCanvas((s) => s.setNotice)
  const target = targetId ? canvas.nodes.find((n) => n.id === targetId) : undefined
  // Not merged, but not discarded either: a merge supersedes its sources, so
  // context left behind would vanish from the merged node's prompt.
  const carried = carriedContext(canvas, [aId, bId])
  const a = canvas.nodes.find((n) => n.id === aId)!
  const b = canvas.nodes.find((n) => n.id === bId)!

  /*
   * The merged node is a new experiment, so it does not have to inherit a
   * branch's model. Defaults to what is being rebuilt, or to the first
   * branch's, which keeps the common case a single click.
   */
  const [model, setModel] = useState<ModelId>(target?.data.model ?? a.data.model)
  // Two branches on different models are not a prompt comparison; the prompt
  // and the model both moved, and the diff cannot tell you which mattered.
  const mixedModels = a.data.model !== b.data.model

  const [source, setSource] = useState<'prompts' | 'outputs'>('prompts')
  const [view, setView] = useState<'split' | 'unified'>('split')
  const [hideSame, setHideSame] = useState(false)
  const [merged, setMerged] = useState('')
  const [synthesising, setSynthesising] = useState(false)

  /*
   * Corrections only, on the prompt side. Flattening every kind into one
   * string diffed one branch's source material against the other's
   * instructions, and wrote the result back as a correction — so context
   * came out the far side as something the model was told to obey.
   */
  const textOf = (node: typeof a) =>
    source === 'prompts' ? correctionText(node) : (node.data.runs.at(-1)?.text ?? '')

  const aText = useMemo(() => textOf(a), [a, source])
  const bText = useMemo(() => textOf(b), [b, source])

  const rows = useMemo(() => alignRows(aText, bText), [aText, bText])
  const changes = useMemo(() => countChanges(rows), [rows])
  const unified = useMemo(() => inlineDiff(aText, bText), [aText, bText])
  const phrases = useMemo(() => alignPhrases(aText, bText), [aText, bText])

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(alignPhrases(aText, bText).filter((p) => p.side === 'both').map((p) => p.id)),
  )

  const picked = assemble(phrases, selected)
  const visibleRows = hideSame ? rows.filter((r) => r.kind !== 'same') : rows

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const synthesise = async () => {
    setSynthesising(true)
    setMerged('')
    try {
      const goal = composePrompt(canvas, aId).instruction
      const text = buildSynthesisPrompt({
        goal,
        promptA: correctionText(a),
        promptB: correctionText(b),
        outputA: a.data.runs.at(-1)?.text,
        outputB: b.data.runs.at(-1)?.text,
      })
      let acc = ''
      await generate(
        `merge-${Date.now()}`,
        a.data.model,
        {
          system:
            'You are a prompt engineer. You rewrite and combine prompts. You return prompt text only.',
          blocks: [],
          instruction: text,
          sharedPrefixLength: 0,
          text,
        },
        400,
        {
          onText: (d) => {
            acc += d
            setMerged(acc)
          },
        },
      )
    } catch (err) {
      setNotice({ kind: 'error', text: formatError(err) })
    } finally {
      setSynthesising(false)
    }
  }

  const finalText = merged.trim() || picked.trim()

  return (
    <Modal title={target ? 'Rebuild merge' : 'Diff & Merge'} onClose={onClose} wide>
      {mixedModels && source === 'outputs' && (
        <div className="mb-3 rounded-md border border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10 p-2 text-[11px] leading-relaxed text-[var(--color-ink)]">
          These branches ran on different models &mdash; {specFor(a.data.model).label} and{' '}
          {specFor(b.data.model).label}. The outputs differ for two reasons at once, so this diff
          cannot tell you which one the prompt is responsible for.
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'prompts', label: 'prompts' },
            { value: 'outputs', label: 'outputs' },
          ]}
        />
        <span className="text-[var(--color-edge)]">|</span>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'split', label: 'side by side' },
            { value: 'unified', label: 'inline' },
          ]}
        />
        {view === 'split' && changes > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={hideSame}
              onChange={(e) => setHideSame(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            only changes
          </label>
        )}
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          {changes === 0 ? 'identical' : `${changes} ${changes === 1 ? 'difference' : 'differences'}`}
        </span>
      </div>

      {view === 'split' ? (
        <div className="mb-4 overflow-hidden rounded border border-[var(--color-edge)]">
          <div className="grid grid-cols-2 border-b border-[var(--color-edge)] bg-[var(--color-canvas)] text-[11px] font-medium">
            <div className="truncate border-r border-[var(--color-edge)] px-2.5 py-1.5 text-[var(--color-danger)]">
              A · {a.data.title}
            </div>
            <div className="truncate px-2.5 py-1.5 text-[var(--color-good)]">
              B · {b.data.title}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {visibleRows.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-[12px] text-[#5a6175]">
                {rows.length === 0
                  ? 'Nothing to compare.'
                  : 'These two are identical. Branches this similar are probably not testing anything.'}
              </p>
            ) : (
              visibleRows.map((row) => <SplitRow key={row.id} row={row} />)
            )}
          </div>
        </div>
      ) : (
        <div className="mb-4 max-h-64 overflow-y-auto rounded border border-[var(--color-edge)] bg-[var(--color-canvas)] p-2.5 text-[12px] leading-relaxed">
          {unified.length === 0 ? (
            <span className="text-[#5a6175]">Nothing to compare.</span>
          ) : (
            unified.map((c, i) => (
              <span
                key={i}
                className={
                  c.kind === 'added'
                    ? 'rounded-sm bg-[#16332a] text-[var(--color-good)]'
                    : c.kind === 'removed'
                      ? 'rounded-sm bg-[#3a1f22] text-[var(--color-danger)] line-through decoration-[var(--color-danger)]/50'
                      : ''
                }
              >
                {c.value}
              </span>
            ))
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              Pick phrases
            </span>
            <span className="text-[11px] text-[#5a6175]">{selected.size} selected</span>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-[var(--color-edge)] p-1.5">
            {phrases.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px] leading-snug hover:bg-[var(--color-edge)]/50 ${
                  selected.has(p.id) ? '' : 'opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <span className="flex-1">{p.text}</span>
                <Badge tone={p.side === 'both' ? 'neutral' : p.side === 'a' ? 'danger' : 'good'}>
                  {p.side === 'both' ? 'both' : p.side.toUpperCase()}
                </Badge>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              Merged prompt
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={synthesising}
              onClick={() => void synthesise()}
            >
              {synthesising ? 'Synthesising…' : 'Synthesise with the model'}
            </Button>
          </div>
          <MarkdownEditor
            value={finalText}
            onChange={setMerged}
            rows={11}
            placeholder="Select phrases on the left, or synthesise with the model. You can edit the result here."
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-edge)] pt-3">
        <p className="flex-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
          {carried.length > 0 && (
            <>
              Corrections are merged; {carried.length} context block
              {carried.length === 1 ? '' : 's'} carried through unchanged.{' '}
            </>
          )}
          {target
            ? `Replaces the merged text on "${target.data.title}", keeping its place in the graph, its edges and its runs. Neither branch is modified.`
            : 'Creates a new node with edges from both branches. Neither parent is modified.'}
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          Run on
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelId)}
            className="rounded border border-[var(--color-edge)] bg-[var(--color-canvas)] px-1.5 py-1 text-[11px] text-[var(--color-ink)]"
          >
            {Object.values(MODELS).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!finalText}
          onClick={() => {
            if (target) replaceMergeNode(target.id, finalText, model)
            else addMergeNode(aId, bId, finalText, model)
            onClose()
          }}
        >
          {target ? 'Replace merged node' : 'Create merge node'}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * One row of the side-by-side view.
 *
 * Unchanged rows are deliberately dim and unmarked so the eye skips them. Only
 * `changed` rows carry word-level highlighting, and each column shows only its
 * own side's markers — the A column never renders B's insertions, so both
 * columns read as continuous prose rather than as a merge conflict.
 */
function SplitRow({ row }: { row: DiffRow }) {
  const tint =
    row.kind === 'same'
      ? ''
      : row.kind === 'added'
        ? 'bg-[#16332a]/25'
        : row.kind === 'removed'
          ? 'bg-[#3a1f22]/25'
          : 'bg-[var(--color-warn)]/[0.06]'

  return (
    <div className={`grid grid-cols-2 border-b border-[var(--color-edge)]/50 last:border-b-0 ${tint}`}>
      <Cell
        side="a"
        kind={row.kind}
        text={row.a}
        chunks={row.aChunks}
        className="border-r border-[var(--color-edge)]/50"
      />
      <Cell side="b" kind={row.kind} text={row.b} chunks={row.bChunks} />
    </div>
  )
}

function Cell({
  side,
  kind,
  text,
  chunks,
  className = '',
}: {
  side: 'a' | 'b'
  kind: DiffRow['kind']
  text?: string
  chunks?: InlineChunk[]
  className?: string
}) {
  // A gutter marker gives the row a meaning that does not depend on colour.
  const marker =
    kind === 'same' ? '' : kind === 'changed' ? '~' : side === 'a' ? '−' : '+'
  const markerTone =
    kind === 'changed'
      ? 'text-[var(--color-warn)]'
      : side === 'a'
        ? 'text-[var(--color-danger)]'
        : 'text-[var(--color-good)]'

  if (text === undefined) {
    // Absent on this side: a quiet placeholder keeps the two columns aligned.
    return <div className={`min-h-[30px] bg-[var(--color-canvas)]/40 px-2.5 py-1.5 ${className}`} />
  }

  return (
    <div className={`flex gap-1.5 px-2.5 py-1.5 text-[12px] leading-relaxed ${className}`}>
      <span className={`w-2 shrink-0 select-none font-mono ${markerTone}`}>{marker}</span>
      <span className={kind === 'same' ? 'text-[var(--color-muted)]' : ''}>
        {chunks
          ? chunks.map((c, i) => (
              <span
                key={i}
                className={
                  c.kind === 'removed'
                    ? 'rounded-sm bg-[#3a1f22] px-0.5 text-[var(--color-danger)]'
                    : c.kind === 'added'
                      ? 'rounded-sm bg-[#16332a] px-0.5 text-[var(--color-good)]'
                      : ''
                }
              >
                {c.value}
              </span>
            ))
          : text}
      </span>
    </div>
  )
}
