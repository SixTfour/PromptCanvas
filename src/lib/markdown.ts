/**
 * Text transforms behind the markdown editor toolbar.
 *
 * Kept pure and out of the component so the fiddly parts — where the caret
 * lands, what happens with no selection, whether a second press undoes the
 * first — are testable without a DOM. Every function returns the new text plus
 * the selection to restore, because a formatting button that loses your place
 * in the text is worse than no button.
 */

export interface EditResult {
  text: string
  start: number
  end: number
}

/** Selection bounds expanded to cover whole lines. */
function lineBounds(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const nextBreak = text.indexOf('\n', end)
  const to = nextBreak === -1 ? text.length : nextBreak
  return { from, to }
}

/**
 * Wrap or unwrap the selection with an inline marker, e.g. `**` for bold.
 *
 * Pressing the button twice returns the text to where it started, including
 * when the markers sit just outside the selection — which is what happens when
 * you select a word by double-clicking and hit bold twice.
 */
export function toggleWrap(text: string, start: number, end: number, marker: string): EditResult {
  const selected = text.slice(start, end)
  const len = marker.length

  // Case 1: the markers are inside the selection.
  if (
    selected.length >= len * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len)
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length }
  }

  // Case 2: the markers sit immediately outside the selection.
  const before = text.slice(Math.max(0, start - len), start)
  const after = text.slice(end, end + len)
  if (before === marker && after === marker) {
    return {
      text: text.slice(0, start - len) + selected + text.slice(end + len),
      start: start - len,
      end: end - len,
    }
  }

  // Otherwise wrap. With no selection this drops the caret between the markers,
  // ready to type, rather than after them.
  const wrapped = marker + selected + marker
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    start: start + len,
    end: start + len + selected.length,
  }
}

/**
 * Add or remove a line prefix across every line the selection touches.
 *
 * Removal only when *every* touched line already has it, so a partially
 * bulleted selection completes rather than clears — which is nearly always what
 * was meant.
 */
export function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
): EditResult {
  const { from, to } = lineBounds(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const allPrefixed = lines.every((l) => l.startsWith(prefix))

  const next = lines
    .map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l))
    .join('\n')

  const delta = next.length - (to - from)
  const firstDelta = allPrefixed ? -prefix.length : prefix.length
  return {
    text: text.slice(0, from) + next + text.slice(to),
    start: Math.max(from, start + firstDelta),
    end: Math.max(from, end + delta),
  }
}

/** Number every touched line, or strip existing numbering. */
export function toggleOrderedList(text: string, start: number, end: number): EditResult {
  const { from, to } = lineBounds(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const numbered = /^\d+\.\s/
  const allNumbered = lines.every((l) => numbered.test(l))

  const next = lines
    .map((l, i) => (allNumbered ? l.replace(numbered, '') : `${i + 1}. ${l}`))
    .join('\n')

  return {
    text: text.slice(0, from) + next + text.slice(to),
    start: from,
    end: from + next.length,
  }
}

/** Insert a link, keeping any selected text as the label. */
export function insertLink(text: string, start: number, end: number): EditResult {
  const label = text.slice(start, end) || 'text'
  const snippet = `[${label}](url)`
  // Select the placeholder URL, since that is the part still to be filled in.
  const urlStart = start + label.length + 3
  return {
    text: text.slice(0, start) + snippet + text.slice(end),
    start: urlStart,
    end: urlStart + 3,
  }
}

/** Rough reading stats for the editor footer. */
export function textStats(text: string): { words: number; chars: number; lines: number } {
  const trimmed = text.trim()
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: text.length,
    lines: text ? text.split('\n').length : 0,
  }
}
