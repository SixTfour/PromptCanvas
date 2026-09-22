import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { formatTokens } from '../../lib/models'
import { isMergeStale } from '../../lib/merge'
import { useCanvas } from '../../store/useCanvas'
import type { PromptNodeData } from '../../types'
import { Markdown } from '../Markdown'
import { Badge, IconButton } from '../ui'

/**
 * A node on the canvas.
 *
 * The generated text is the point of this tool, so it gets the body of the card
 * and the only high-contrast type on it. Everything else — title, badges,
 * counters, actions — is chrome sized and coloured to stay out of its way. The
 * prompt that produced it lives in the inspector; putting it here too would
 * turn the canvas into a wall of editable text and stop it being a map.
 */
function PromptNodeInner({ id, data, selected }: NodeProps & { data: PromptNodeData }) {
  const toggleCompare = useCanvas((s) => s.toggleCompare)
  const compare = useCanvas((s) => s.compare)
  const addBranch = useCanvas((s) => s.addBranch)
  const runNode = useCanvas((s) => s.runNode)
  const cancelNode = useCanvas((s) => s.cancelNode)

  const canvas = useCanvas((s) => s.canvas)

  const inCompare = compare.includes(id)
  // A merged node ignores its parents' blocks by design, so divergence has to
  // be shown rather than inferred from the prompt.
  const stale = isMergeStale(canvas, id)
  const runs = data.runs
  const latest = runs.at(-1)
  const busy = latest?.status === 'streaming' || latest?.status === 'loading'
  const done = runs.filter((r) => r.status === 'done')
  const failed = runs.filter((r) => r.status === 'error')
  const stats = done.at(-1)?.stats
  const isMerge = Boolean(data.mergedFrom)

  // Prefer the newest completed text, but show a stream in flight as it arrives.
  const shown = busy ? (latest?.text ?? '') : (done.at(-1)?.text ?? latest?.text ?? '')
  const errored = latest?.status === 'error' ? latest.error : undefined

  return (
    <div
      className={`flex w-[320px] flex-col rounded-lg border bg-[var(--color-panel)] transition-shadow ${
        selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-[var(--color-edge)]'
      } ${inCompare ? 'ring-2 ring-[var(--color-warn)]/60' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          {data.title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {isMerge && <Badge tone="accent">merge</Badge>}
          {stale && (
            <span title="A branch this was merged from has changed since. Select this node to rebuild it.">
              <Badge tone="danger">out of date</Badge>
            </span>
          )}
          {data.blocks.some((b) => b.kind === 'correction' && b.enabled) && (
            <Badge tone="warn">correction</Badge>
          )}
        </span>
      </div>

      {/* The body: output first, largest, highest contrast. */}
      <div className="mx-3 mb-2 min-h-[132px] rounded border border-[var(--color-edge)]/70 bg-[var(--color-canvas)] p-2.5">
        {errored ? (
          <div className="max-h-[128px] overflow-hidden text-[12px] leading-relaxed text-[var(--color-danger)]">
            {errored}
          </div>
        ) : shown ? (
          /* Clipped with a mask rather than line-clamp: -webkit-line-clamp and
             pre-wrap disagree about where a line ends, and the fade also reads
             as "there is more of this" rather than as a hard cut. */
          <div
            className="max-h-[128px] overflow-hidden text-[12.5px] leading-relaxed text-[var(--color-ink)]"
            style={{
              maskImage: 'linear-gradient(to bottom, #000 76%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 76%, transparent 100%)',
            }}
          >
            <Markdown>{shown}</Markdown>
            {busy && (
              <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-[var(--color-accent)]" />
            )}
          </div>
        ) : busy ? (
          <p className="text-[12px] text-[var(--color-muted)]">
            {latest?.status === 'loading' ? 'Loading model…' : 'Generating…'}
          </p>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void runNode(id)
            }}
            className="flex h-full min-h-[112px] w-full flex-col items-center justify-center gap-1 rounded text-[12px] text-[#5a6175] hover:bg-[var(--color-edge)]/30 hover:text-[var(--color-ink)]"
          >
            <span className="text-[15px]">▷</span>
            <span>Run to generate</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--color-edge)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
        <span className="truncate">
          {done.length > 0 ? (
            <>
              {done.length} {done.length === 1 ? 'run' : 'runs'}
              {stats && (
                <span className="text-[#5a6175]">
                  {' · '}
                  {formatTokens(stats.completionTokens)} tok · {stats.tokensPerSecond.toFixed(1)}/s
                </span>
              )}
            </>
          ) : failed.length > 0 ? (
            <span className="text-[var(--color-danger)]">{failed.length} failed</span>
          ) : (
            'not run'
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton
            icon="branch"
            label="Branch from this node"
            onClick={(e) => {
              e.stopPropagation()
              addBranch(id)
            }}
          />
          <IconButton
            icon="compare"
            // Filled when pinned, so the state is visible without reading a word.
            filled={inCompare}
            tone={inCompare ? 'warn' : 'muted'}
            label={inCompare ? 'Unpin from the comparison tray' : 'Pin to the comparison tray'}
            onClick={(e) => {
              e.stopPropagation()
              toggleCompare(id)
            }}
          />
          {busy ? (
            <IconButton
              icon="stop"
              filled
              tone="danger"
              label="Stop generating"
              onClick={(e) => {
                e.stopPropagation()
                cancelNode(id)
              }}
            />
          ) : (
            <IconButton
              icon={shown ? 'rerun' : 'run'}
              filled={!shown}
              tone="accent"
              label={shown ? 'Run again' : 'Run this prompt'}
              onClick={(e) => {
                e.stopPropagation()
                void runNode(id)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export const PromptNode = memo(PromptNodeInner)
