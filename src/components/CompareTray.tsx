import { useState } from 'react'
import { similarity } from '../lib/diff'
import { useCanvas } from '../store/useCanvas'
import { DiffMerge } from './DiffMerge'
import { Badge, Button } from './ui'

/**
 * Side-by-side comparison.
 *
 * Shows every sample per branch rather than only the latest, because the point
 * of running N samples is to see the spread. A branch whose three samples
 * disagree with each other has not beaten anything.
 */
export function CompareTray() {
  const canvas = useCanvas((s) => s.canvas)
  const compare = useCanvas((s) => s.compare)
  const clearCompare = useCanvas((s) => s.clearCompare)
  const toggleCompare = useCanvas((s) => s.toggleCompare)
  const runMany = useCanvas((s) => s.runMany)
  const [showMerge, setShowMerge] = useState(false)

  if (compare.length === 0) return null

  const nodes = compare
    .map((id) => canvas.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))

  const canMerge = nodes.length === 2
  const tooSimilar =
    canMerge &&
    similarity(
      nodes[0].data.runs.at(-1)?.text ?? '',
      nodes[1].data.runs.at(-1)?.text ?? '',
    ) > 0.9

  return (
    <>
      <div className="flex h-full flex-col border-t border-[var(--color-edge)] bg-[var(--color-panel)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-edge)] px-3 py-2">
          <span className="text-[12px] font-semibold">Compare</span>
          <span className="text-[11px] text-[var(--color-muted)]">{nodes.length} pinned</span>
          {tooSimilar && (
            <span className="text-[11px] text-[var(--color-warn)]">
              these outputs are &gt;90% identical — the branches may not be testing anything
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => void runMany(compare, 1)}>
              Run all
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!canMerge}
              title={canMerge ? undefined : 'Pin exactly two branches to merge'}
              onClick={() => setShowMerge(true)}
            >
              Diff &amp; Merge
            </Button>
            <Button size="sm" variant="ghost" onClick={clearCompare}>
              Clear
            </Button>
          </div>
        </div>

        <div className="flex flex-1 gap-3 overflow-x-auto p-3">
          {nodes.map((n) => {
            return (
              <div
                key={n.id}
                className="flex min-w-[340px] max-w-[460px] flex-1 flex-col rounded-md border border-[var(--color-edge)] bg-[var(--color-canvas)]"
              >
                <div className="flex items-center gap-2 border-b border-[var(--color-edge)] px-2.5 py-1.5">
                  <span className="truncate text-[12px] font-medium">{n.data.title}</span>
                  {n.data.mergedFrom && <Badge tone="accent">merge</Badge>}
                  <span className="ml-auto shrink-0 text-[11px] text-[var(--color-muted)]">
                    {n.data.runs.length > 0 ? `${n.data.runs.length}x` : ''}
                  </span>
                  <button
                    onClick={() => toggleCompare(n.id)}
                    className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    title="Unpin"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {n.data.runs.length === 0 && (
                    <p className="text-[11px] text-[#5a6175]">No samples.</p>
                  )}
                  {n.data.runs.map((r, i) => (
                    <div key={r.id}>
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#5a6175]">
                        <span>sample {i + 1}</span>
                        {r.status === 'streaming' && <Badge tone="accent">live</Badge>}
                        {r.status === 'error' && <Badge tone="danger">error</Badge>}
                      </div>
                      <pre className="whitespace-pre-wrap rounded bg-[var(--color-panel)] p-2 text-[12px] leading-relaxed">
                        {r.error ?? r.text ?? ''}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showMerge && canMerge && (
        <DiffMerge aId={nodes[0].id} bId={nodes[1].id} onClose={() => setShowMerge(false)} />
      )}
    </>
  )
}
