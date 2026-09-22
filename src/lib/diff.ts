import { diffArrays, diffWordsWithSpace } from 'diff'

/**
 * Diff & Merge.
 *
 * Two levels of granularity, for two different jobs:
 *
 *   - `inlineDiff` is word-level, for *reading* the difference between two
 *     branches at a glance.
 *   - `alignPhrases` is phrase-level, for *building* something new. Merging works
 *     by picking whole phrases, because a word-level merge produces grammatical
 *     rubble and nobody wants to hand-repair it.
 */

export interface InlineChunk {
  value: string
  kind: 'same' | 'added' | 'removed'
}

export function inlineDiff(a: string, b: string): InlineChunk[] {
  return diffWordsWithSpace(a, b).map((p) => ({
    value: p.value,
    kind: p.added ? 'added' : p.removed ? 'removed' : 'same',
  }))
}

export interface Phrase {
  id: string
  text: string
  /** Which side this phrase came from. */
  side: 'a' | 'b' | 'both'
}

/**
 * Split prose into pickable units.
 *
 * Sentence boundaries first, then hard line breaks, because prompt text is
 * usually a mix of instruction sentences and bulleted constraints, and a bullet
 * is a unit whether or not it ends in a full stop.
 */
export function segmentPhrases(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Keep list markers and headings whole; only split flowing prose.
    if (/^([-*+]|\d+[.)]|#{1,6})\s/.test(trimmed)) {
      out.push(trimmed)
      continue
    }
    const sentences = trimmed.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)
    if (sentences) out.push(...sentences.map((s) => s.trim()).filter(Boolean))
    else out.push(trimmed)
  }
  return out
}

/** Normalised form used only for equality testing during alignment. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim()
}

/**
 * Align two texts into an ordered list of phrases, marking which side each came
 * from. Phrases that both sides share appear once, as `both` — those are the
 * uncontroversial backbone of a merge, and the UI selects them by default.
 */
export function alignPhrases(aText: string, bText: string): Phrase[] {
  const a = segmentPhrases(aText)
  const b = segmentPhrases(bText)

  const parts = diffArrays(a.map(norm), b.map(norm))

  const out: Phrase[] = []
  let ai = 0
  let bi = 0
  let seq = 0

  for (const part of parts) {
    const count = part.count ?? part.value.length
    if (part.added) {
      for (let i = 0; i < count; i++) out.push({ id: `p${seq++}`, text: b[bi++], side: 'b' })
    } else if (part.removed) {
      for (let i = 0; i < count; i++) out.push({ id: `p${seq++}`, text: a[ai++], side: 'a' })
    } else {
      // Common run: keep side A's original casing and punctuation.
      for (let i = 0; i < count; i++) {
        out.push({ id: `p${seq++}`, text: a[ai++], side: 'both' })
        bi++
      }
    }
  }
  return out
}

/** Stitch selected phrases back into a prompt body. */
export function assemble(phrases: Phrase[], selected: Set<string>): string {
  return phrases
    .filter((p) => selected.has(p.id))
    .map((p) => p.text.trim())
    .join('\n')
}

/** Crude similarity, used to warn when two branches barely differ. */
export function similarity(a: string, b: string): number {
  const pa = new Set(segmentPhrases(a).map(norm))
  const pb = new Set(segmentPhrases(b).map(norm))
  if (pa.size === 0 && pb.size === 0) return 1
  let shared = 0
  for (const p of pa) if (pb.has(p)) shared++
  return (2 * shared) / (pa.size + pb.size)
}

/**
 * The meta-prompt behind "Synthesise with the model".
 *
 * Kept here rather than inline at the call site so it is visible, reviewable, and
 * editable — this is a prompt engineering tool, and hiding its own prompt would
 * be a poor look.
 */
export function buildSynthesisPrompt(input: {
  goal: string
  promptA: string
  promptB: string
  outputA?: string
  outputB?: string
}): string {
  const parts = [
    '# Task',
    'Two variants of a prompt were tried. Synthesise a single stronger prompt that keeps what worked in each and drops what did not.',
    '',
    '# What the prompt is trying to achieve',
    input.goal.trim() || '(not stated)',
    '',
    '# Variant A — prompt',
    input.promptA.trim(),
  ]
  if (input.outputA?.trim()) parts.push('', '# Variant A — what the model produced', input.outputA.trim())
  parts.push('', '# Variant B — prompt', input.promptB.trim())
  if (input.outputB?.trim()) parts.push('', '# Variant B — what the model produced', input.outputB.trim())
  parts.push(
    '',
    '# Instructions',
    '- Return only the synthesised prompt text. No preamble, no explanation, no code fences.',
    '- Preserve concrete constraints and specific wording that appear to be doing real work.',
    '- Remove redundancy and anything the outputs suggest was ignored or counterproductive.',
    '- Keep it at most as long as the longer of the two variants.',
  )
  return parts.join('\n')
}

export interface DiffRow {
  id: string
  /**
   * `changed` is a phrase that exists on both sides in different words — the
   * common case when a branch reworks a line rather than adding or cutting one.
   * Keeping those two phrases on one row is the whole point of the split view.
   */
  kind: 'same' | 'changed' | 'added' | 'removed'
  a?: string
  b?: string
  /** Word-level chunks, populated only for `changed` rows. */
  aChunks?: InlineChunk[]
  bChunks?: InlineChunk[]
}

/**
 * Word-level diff of a single phrase pair, split per side.
 *
 * The A column shows what was there (unchanged words plus removals); the B
 * column shows what replaced it (unchanged words plus additions). Neither
 * column carries the other side's markers, so each one reads as prose.
 */
function sideChunks(a: string, b: string): { aChunks: InlineChunk[]; bChunks: InlineChunk[] } {
  const parts = diffWordsWithSpace(a, b)
  const aChunks: InlineChunk[] = []
  const bChunks: InlineChunk[] = []
  for (const p of parts) {
    if (p.added) bChunks.push({ value: p.value, kind: 'added' })
    else if (p.removed) aChunks.push({ value: p.value, kind: 'removed' })
    else {
      aChunks.push({ value: p.value, kind: 'same' })
      bChunks.push({ value: p.value, kind: 'same' })
    }
  }
  return { aChunks, bChunks }
}

/**
 * Align two texts into side-by-side rows.
 *
 * A unified word-level diff of two prompt variants reads as confetti: every
 * reworded line becomes alternating strikethrough and insert, and the eye has
 * nothing stable to follow. Rows fix that by giving each side its own column and
 * pairing a removal with the addition that replaced it, so a reworded phrase is
 * one row you read across rather than two fragments you reassemble.
 */
export function alignRows(aText: string, bText: string): DiffRow[] {
  const a = segmentPhrases(aText)
  const b = segmentPhrases(bText)
  const parts = diffArrays(a.map(norm), b.map(norm))

  const rows: DiffRow[] = []
  let ai = 0
  let bi = 0
  let seq = 0

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const count = part.count ?? part.value.length

    if (!part.added && !part.removed) {
      for (let k = 0; k < count; k++) {
        rows.push({ id: `r${seq++}`, kind: 'same', a: a[ai++], b: b[bi++] })
      }
      continue
    }

    if (part.removed) {
      // A removal immediately followed by an addition is a rewrite, not a
      // delete-then-insert. Zip them so the two versions sit on one row.
      const next = parts[i + 1]
      const addCount = next?.added ? (next.count ?? next.value.length) : 0
      const paired = Math.min(count, addCount)

      for (let k = 0; k < paired; k++) {
        const left = a[ai++]
        const right = b[bi++]
        rows.push({ id: `r${seq++}`, kind: 'changed', a: left, b: right, ...sideChunks(left, right) })
      }
      for (let k = paired; k < count; k++) {
        rows.push({ id: `r${seq++}`, kind: 'removed', a: a[ai++] })
      }
      if (addCount > 0) {
        for (let k = paired; k < addCount; k++) {
          rows.push({ id: `r${seq++}`, kind: 'added', b: b[bi++] })
        }
        i++ // the addition run was consumed here
      }
      continue
    }

    // A pure addition run with no preceding removal.
    for (let k = 0; k < count; k++) {
      rows.push({ id: `r${seq++}`, kind: 'added', b: b[bi++] })
    }
  }

  return rows
}

/** How many rows differ, for the "N changes" counter and the empty state. */
export function countChanges(rows: DiffRow[]): number {
  return rows.filter((r) => r.kind !== 'same').length
}
