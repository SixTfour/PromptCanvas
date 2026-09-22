import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { formatTokens } from '../../lib/models'
import { useCanvas } from '../../store/useCanvas'
import type { PromptNodeData } from '../../types'
import { Badge } from '../ui'

/**
 * A node on the canvas.
 *
 * Deliberately shows aggregate state rather than full text: how many samples
 * were run, whether they agreed, what they cost. The full prompt and every
 * response live in the inspector and the compare tray, because a canvas whose
 * nodes contain scrollable prose stops being a map.
 */
function PromptNodeInner({ id, data, selected }: NodeProps & { data: PromptNodeData }) {
  const toggleCompare = useCanvas((s) => s.toggleCompare)
  const compare = useCanvas((s) => s.compare)
  const addBranch = useCanvas((s) => s.addBranch)
  const runNode = useCanvas((s) => s.runNode)
  const cancelNode = useCanvas((s) => s.cancelNode)

  const inCompare = compare.includes(id)
  const runs = data.runs
  const streaming = runs.some((r) => r.status === 'streaming')
  const done = runs.filter((r) => r.status === 'done')
  const errored = runs.filter((r) => r.status === 'error')
  const lastStats = done.at(-1)?.stats
  const isMerge = Boolean(data.mergedFrom)

  const preview = done.at(-1)?.text ?? runs.at(-1)?.text ?? ''

  return (
    <div
      className={`w-[280px] rounded-lg border bg-[var(--color-panel)] transition-shadow ${
        selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-[var(--color-edge)]'
      } ${inCompare ? 'ring-2 ring-[var(--color-warn)]/60' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">{data.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isMerge && <Badge tone="accent">merge</Badge>}
            {data.blocks.some((b) => b.kind === 'correction' && b.enabled) && (
              <Badge tone="warn">correction</Badge>
            )}
            {streaming && <Badge tone="accent">running</Badge>}
            {errored.length > 0 && <Badge tone="danger">{errored.length} failed</Badge>}
          </div>
        </div>
      </div>

      {preview ? (
        <div className="mx-3 mb-2 max-h-[62px] overflow-hidden rounded bg-[var(--color-canvas)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-muted)]">
          {preview.slice(0, 220)}
          {preview.length > 220 ? '…' : ''}
        </div>
      ) : (
        <div className="mx-3 mb-2 rounded border border-dashed border-[var(--color-edge)] px-2 py-2.5 text-center text-[11px] text-[#5a6175]">
          not run yet
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--color-edge)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
        <span>
          {done.length} {done.length === 1 ? 'sample' : 'samples'}
          {lastStats && (
            <span className="ml-2 text-[#5a6175]">
              {formatTokens(lastStats.completionTokens)} tok ·{' '}
              {lastStats.tokensPerSecond.toFixed(1)}/s
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="rounded px-1.5 py-0.5 hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]"
            title="Branch from this node"
            onClick={(e) => {
              e.stopPropagation()
              addBranch(id)
            }}
          >
            branch
          </button>
          <button
            className={`rounded px-1.5 py-0.5 hover:bg-[var(--color-edge)] ${
              inCompare ? 'text-[var(--color-warn)]' : 'hover:text-[var(--color-ink)]'
            }`}
            title="Pin to the comparison tray"
            onClick={(e) => {
              e.stopPropagation()
              toggleCompare(id)
            }}
          >
            {inCompare ? 'pinned' : 'compare'}
          </button>
          {streaming ? (
            <button
              className="rounded px-1.5 py-0.5 text-[var(--color-danger)] hover:bg-[var(--color-edge)]"
              onClick={(e) => {
                e.stopPropagation()
                cancelNode(id)
              }}
            >
              stop
            </button>
          ) : (
            <button
              className="rounded px-1.5 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-edge)]"
              onClick={(e) => {
                e.stopPropagation()
                void runNode(id)
              }}
            >
              run
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export const PromptNode = memo(PromptNodeInner)
