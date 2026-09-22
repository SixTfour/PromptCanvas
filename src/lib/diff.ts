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
