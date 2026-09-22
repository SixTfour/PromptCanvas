/**
 * Small remembered view preferences.
 *
 * Things like "show me the rendered version" are a standing choice about how
 * someone wants to read, not a per-visit decision, so resetting them on every
 * reload quietly undoes the same click over and over.
 *
 * Values are validated against the set the code actually understands on the way
 * out. Stored preferences outlive the code that wrote them: an option renamed
 * or removed in a later version would otherwise come back as a state the UI has
 * no branch for, and the failure would look like a rendering bug rather than
 * stale storage.
 *
 * Storage is injectable so the behaviour is testable without a browser, and
 * every access is guarded — private windows and blocked site data both make
 * localStorage throw rather than return null.
 */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readPref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  storage: StorageLike | null = safeStorage(),
): T {
  try {
    const raw = storage?.getItem(key)
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

export function writePref(
  key: string,
  value: string,
  storage: StorageLike | null = safeStorage(),
): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // A preference that cannot be saved is not worth interrupting anyone over.
  }
}
