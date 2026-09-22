import { useEffect, useState } from 'react'
import type { CanvasSummary } from '../lib/storage'
import { formatRelativeTime } from '../lib/time'
import { useCanvas } from '../store/useCanvas'
import { Badge, Button, Modal } from './ui'

/**
 * Saved sessions.
 *
 * Canvases have always been written to IndexedDB on every edit; until now there
 * was no way to see or reopen them, so the work simply accumulated out of
 * sight. This lists them newest first, with the counts that tell you which one
 * you actually want — a session is worth reopening because of what it has
 * generated, not because of its name.
 */
export function SessionBrowser({ onClose }: { onClose: () => void }) {
  const currentId = useCanvas((s) => s.canvas.id)
  const listSessions = useCanvas((s) => s.listSessions)
  const openSession = useCanvas((s) => s.openSession)
  const duplicateSession = useCanvas((s) => s.duplicateSession)
  const deleteSession = useCanvas((s) => s.deleteSession)
  const newCanvas = useCanvas((s) => s.newCanvas)
  const setNotice = useCanvas((s) => s.setNotice)

  const [sessions, setSessions] = useState<CanvasSummary[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => void listSessions().then(setSessions)
  useEffect(refresh, [listSessions])

  const open = async (id: string) => {
    setBusy(true)
    await openSession(id)
    setBusy(false)
    onClose()
  }

  return (
    <Modal title="Sessions" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
            Every canvas is saved in this browser as you work, and the one you had open is
            restored when you come back. Nothing is uploaded anywhere.
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              newCanvas()
              setNotice({ kind: 'info', text: 'Started a new session.' })
              onClose()
            }}
          >
            New session
          </Button>
        </div>

        {sessions === null ? (
          <p className="px-2 py-8 text-center text-[12px] text-[#5a6175]">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-8 text-center text-[12px] text-[#5a6175]">
            No saved sessions yet. This one will appear here as soon as you edit it.
          </p>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((s) => {
              const isCurrent = s.id === currentId
              return (
                <div
                  key={s.id}
                  className={`rounded-md border px-3 py-2.5 ${
                    isCurrent
                      ? 'border-[var(--color-accent)]/50 bg-[#232a4d]/20'
                      : 'border-[var(--color-edge)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                    {isCurrent && <Badge tone="accent">open</Badge>}
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--color-muted)]">
                      {formatRelativeTime(s.updatedAt)}
                    </span>
                  </div>

                  <div className="mt-0.5 text-[11px] text-[#5a6175]">
                    {s.nodeCount} {s.nodeCount === 1 ? 'node' : 'nodes'} ·{' '}
                    {s.runCount === 0
                      ? 'nothing generated'
                      : `${s.runCount} ${s.runCount === 1 ? 'generation' : 'generations'}`}
                  </div>

                  {confirming === s.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-[var(--color-warn)]">
                        Delete this session and everything in it?
                        {isCurrent && ' It is the one currently open.'}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          setConfirming(null)
                          await deleteSession(s.id)
                          refresh()
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={isCurrent ? 'ghost' : 'default'}
                        disabled={isCurrent || busy}
                        onClick={() => void open(s.id)}
                      >
                        {isCurrent ? 'Currently open' : 'Open'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          await duplicateSession(s.id)
                          refresh()
                        }}
                        title="Copy this session, leaving the original untouched"
                      >
                        Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        className="ml-auto"
                        disabled={busy}
                        onClick={() => setConfirming(s.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-[#5a6175]">
          Sessions live in this browser only — a different browser or machine will not see them,
          and clearing site data removes them along with any cached model weights. Export writes a
          file you can keep or move.
        </p>
      </div>
    </Modal>
  )
}
