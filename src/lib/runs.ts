import type { Run } from '../types'

export interface DisplayRun {
  run: Run
  /** Its place in the order it was created, which is not its place on screen. */
  number: number
}

/**
 * Runs in reading order: newest first.
 *
 * Numbering is assigned before reversing, so "run 3" always means the third one
 * generated. Numbering the rows top-down instead would rename every earlier run
 * each time a new one arrived, which makes a label useless for referring to
 * anything.
 *
 * Reversal rather than a sort on `startedAt`: runs are only ever appended, so
 * array order is already chronological, and reversing cannot be upset by two
 * runs sharing a timestamp or by one that never recorded a start.
 */
export function orderRunsNewestFirst(runs: Run[]): DisplayRun[] {
  return runs.map((run, i) => ({ run, number: i + 1 })).reverse()
}

/**
 * Whether a run's body should be showing.
 *
 * The newest is open because it is what you came to read, and anything still
 * producing tokens is open because collapsing live output would hide the thing
 * being waited for. Everything else starts closed, and an explicit toggle wins
 * over all of it.
 */
export function isRunOpen(
  run: Run,
  isNewest: boolean,
  overrides: Record<string, boolean>,
): boolean {
  const override = overrides[run.id]
  if (override !== undefined) return override
  if (run.status === 'streaming' || run.status === 'loading') return true
  return isNewest
}

/** One line of a collapsed run, enough to tell it from its neighbours. */
export function runPreview(run: Run, limit = 90): string {
  const source = run.error ?? run.text ?? ''
  const flat = source.replace(/\s+/g, ' ').trim()
  if (!flat) return run.status === 'done' ? '(empty response)' : 'no output yet'
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}
