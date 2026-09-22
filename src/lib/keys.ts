/**
 * Keyboard shortcut matching.
 *
 * Pure predicates over a minimal event shape, so the platform rules can be
 * tested without a browser or a Mac.
 */

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

export function isMacPlatform(): boolean {
  const nav = navigator as unknown as {
    userAgentData?: { platform?: string }
    platform?: string
    userAgent?: string
  }
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/**
 * The platform's command modifier.
 *
 * Checked strictly rather than accepting either key: on a Mac, Ctrl+Z is not
 * undo, and treating it as such would fire the wrong action for anyone using
 * Ctrl as a modifier in their terminal-muscle-memory way.
 */
function hasMod(e: KeyLike, mac: boolean): boolean {
  return mac ? Boolean(e.metaKey) : Boolean(e.ctrlKey)
}

export function isUndo(e: KeyLike, mac = isMacPlatform()): boolean {
  return hasMod(e, mac) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'
}

/**
 * Redo.
 *
 * Shift+Z on both platforms, plus Ctrl+Y on Windows where that is conventional.
 * Ctrl+R is deliberately *not* bound: it is the browser's reload, which this
 * app needs — reloading is how you restart the inference worker — and taking it
 * over would cost more than the shortcut is worth.
 */
export function isRedo(e: KeyLike, mac = isMacPlatform()): boolean {
  if (e.altKey) return false
  const key = e.key.toLowerCase()
  if (hasMod(e, mac) && e.shiftKey && key === 'z') return true
  // Cmd+Y is not a Mac convention, so it stays Windows-only.
  if (!mac && e.ctrlKey && !e.shiftKey && key === 'y') return true
  return false
}

/**
 * Whether a keystroke belongs to whatever the user is typing in.
 *
 * Without this, hitting undo while editing a prompt would roll back the whole
 * canvas instead of the last few characters — the browser's own text undo is
 * the right behaviour inside a field, and stealing it would be maddening.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/** Shortcut labels for tooltips, in the platform's own notation. */
export function shortcutLabels(mac = isMacPlatform()): { undo: string; redo: string } {
  return mac ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Y' }
}
