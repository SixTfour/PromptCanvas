/**
 * Committing a typed number.
 *
 * The rule that matters: clamp when the user has *finished*, never while they
 * are typing. Clamping per keystroke makes a field unusable — with a minimum of
 * 16, typing "512" becomes 5, which snaps to 16, and every later digit lands
 * after it. The intermediate states of a number being typed are not values to
 * be corrected; they are a value that does not exist yet.
 */

/**
 * The value to commit for a finished edit, or `current` when there is nothing
 * usable to commit — an empty field or junk reverts rather than jumping to some
 * default the user never asked for.
 */
export function commitNumber(draft: string, current: number, min: number, max: number): number {
  const trimmed = draft.trim()
  if (!trimmed) return current

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return current

  return clamp(Math.round(parsed), min, max)
}

export function clamp(n: number, min: number, max: number): number {
  // Guard the inverted case rather than returning something between two bounds
  // that cannot both be satisfied.
  if (max < min) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * Round numbers worth offering as one-click choices, kept within range.
 *
 * Filtered rather than clamped, because three buttons all reading the same
 * clamped number would be three ways to do one thing.
 */
export function presetsWithin(presets: readonly number[], min: number, max: number): number[] {
  return presets.filter((p) => p >= min && p <= max)
}
