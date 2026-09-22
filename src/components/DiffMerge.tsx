import { useMemo, useState } from 'react'
import { generate } from '../lib/engine'
import { formatError } from '../lib/errors'
import { composePrompt } from '../lib/compose'
import { alignPhrases, assemble, buildSynthesisPrompt, inlineDiff } from '../lib/diff'
import { useCanvas } from '../store/useCanvas'
import { Badge, Button, Field, Modal } from './ui'

/**
 * Diff & Merge.
 *
 * Two ways to build the merged prompt, side by side because they suit different
 * moments:
 *
 *   - **Pick phrases** is deterministic, free, and exact. Phrases shared by both
 *     branches are selected by default; the contested ones are yours to choose.
 *   - **Synthesise with the model** hands both prompts and both outputs to the
 *     local model and asks for a single stronger prompt. On a small model this is
 *     the weaker of the two paths; picking phrases is the reliable one.
 *
 * Whichever you use, the result becomes a *new* node with edges from both
 * parents. Nothing is re-parented and no history is destroyed.
 */
export function DiffMerge({
  aId,
  bId,
  onClose,
}: {
  aId: string
  bId: string
  onClose: () => void
}) {
  const canvas = useCanvas((s) => s.canvas)
  const mode = useCanvas((s) => s.mode)
  const addMergeNode = useCanvas((s) => s.addMergeNode)
  const setNotice = useCanvas((s) => s.setNotice)

  const a = canvas.nodes.find((n) => n.id === aId)!
  const b = canvas.nodes.find((n) => n.id === bId)!

  const [source, setSource] = useState<'prompts' | 'outputs'>('prompts')
  const [merged, setMerged] = useState('')
  const [synthesising, setSynthesising] = useState(false)

  const aText = useMemo(
    () =>
      source === 'prompts'
        ? a.data.blocks.filter((x) => x.enabled).map((x) => x.text).join('\n\n')
        : (a.data.runs.at(-1)?.text ?? ''),
    [a, source],
  )
  const bText = useMemo(
    () =>
      source === 'prompts'
        ? b.data.blocks.filter((x) => x.enabled).map((x) => x.text).join('\n\n')
        : (b.data.runs.at(-1)?.text ?? ''),
    [b, source],
  )

  const phrases = useMemo(() => alignPhrases(aText, bText), [aText, bText])
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(alignPhrases(aText, bText).filter((p) => p.side === 'both').map((p) => p.id)),
  )

  const inline = useMemo(() => inlineDiff(aText, bText), [aText, bText])
  const picked = assemble(phrases, selected)

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const synthesise = async () => {
    if (mode === 'demo') {
      setNotice({
        kind: 'warn',
        text: 'Synthesising runs the local model. Switch to Local mode first, or pick phrases manually.',
      })
      return
    }
    setSynthesising(true)
    setMerged('')
    try {
      const goal = composePrompt(canvas, aId).instruction
      const text = buildSynthesisPrompt({
        goal,
        promptA: a.data.blocks.filter((x) => x.enabled).map((x) => x.text).join('\n\n'),
        promptB: b.data.blocks.filter((x) => x.enabled).map((x) => x.text).join('\n\n'),
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
    <Modal title="Diff & Merge" onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[12px] text-[var(--color-muted)]">Compare</span>
        {(['prompts', 'outputs'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={`rounded px-2 py-1 text-[12px] ${
              source === s
                ? 'bg-[var(--color-accent)] text-[#0b0d12]'
                : 'bg-[var(--color-edge)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          <span className="text-[var(--color-danger)]">A: {a.data.title}</span>
          {' · '}
          <span className="text-[var(--color-good)]">B: {b.data.title}</span>
        </span>
      </div>

      <div className="mb-4 max-h-44 overflow-y-auto rounded border border-[var(--color-edge)] bg-[var(--color-canvas)] p-2.5 text-[12px] leading-relaxed">
        {inline.length === 0 ? (
          <span className="text-[#5a6175]">Nothing to compare.</span>
        ) : (
          inline.map((c, i) => (
            <span
              key={i}
              className={
                c.kind === 'added'
                  ? 'bg-[#16332a] text-[var(--color-good)]'
                  : c.kind === 'removed'
                    ? 'bg-[#3a1f22] text-[var(--color-danger)] line-through'
                    : ''
              }
            >
              {c.value}
            </span>
          ))
        )}
      </div>

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
                <Badge
                  tone={p.side === 'both' ? 'neutral' : p.side === 'a' ? 'danger' : 'good'}
                >
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
            <Button size="sm" variant="ghost" disabled={synthesising} onClick={() => void synthesise()}>
              {synthesising ? 'Synthesising…' : 'Synthesise with the model'}
            </Button>
          </div>
          <Field
            value={finalText}
            onChange={setMerged}
            rows={13}
            placeholder="Select phrases on the left, or synthesise with the model. You can edit the result here."
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-edge)] pt-3">
        <p className="flex-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
          Creates a new node with edges from both branches. Neither parent is modified.
        </p>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!finalText}
          onClick={() => {
            addMergeNode(aId, bId, finalText)
            onClose()
          }}
        >
          Create merge node
        </Button>
      </div>
    </Modal>
  )
}
