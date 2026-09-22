import { describe, expect, it } from 'vitest'
import { type KeyLike, isRedo, isTypingTarget, isUndo } from '../keys'

describe('undo and redo shortcuts', () => {
  const MAC = true
  const WIN = false

  it('uses Cmd on Mac and Ctrl on Windows for undo', () => {
    expect(isUndo({ key: 'z', metaKey: true }, MAC)).toBe(true)
    expect(isUndo({ key: 'z', ctrlKey: true }, WIN)).toBe(true)
  })

  // Ctrl+Z is not undo on a Mac, and firing on it would hijack a keystroke
  // that means something else there.
  it('does not treat the wrong modifier as undo', () => {
    expect(isUndo({ key: 'z', ctrlKey: true }, MAC)).toBe(false)
    expect(isUndo({ key: 'z', metaKey: true }, WIN)).toBe(false)
    expect(isUndo({ key: 'z' }, WIN)).toBe(false)
  })

  it('treats Shift+Z as redo on both platforms', () => {
    expect(isRedo({ key: 'z', metaKey: true, shiftKey: true }, MAC)).toBe(true)
    expect(isRedo({ key: 'z', ctrlKey: true, shiftKey: true }, WIN)).toBe(true)
  })

  it('accepts Ctrl+Y on Windows only, since Cmd+Y is not a Mac convention', () => {
    expect(isRedo({ key: 'y', ctrlKey: true }, WIN)).toBe(true)
    expect(isRedo({ key: 'y', metaKey: true }, MAC)).toBe(false)
  })

  it('never reports the same keystroke as both undo and redo', () => {
    const events: KeyLike[] = [
      { key: 'z', metaKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
      { key: 'z', ctrlKey: true },
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ]
    for (const mac of [MAC, WIN]) {
      for (const e of events) {
        expect(isUndo(e, mac) && isRedo(e, mac), JSON.stringify({ e, mac })).toBe(false)
      }
    }
  })

  it('ignores the shortcuts when Alt is held', () => {
    expect(isUndo({ key: 'z', ctrlKey: true, altKey: true }, WIN)).toBe(false)
    expect(isRedo({ key: 'y', ctrlKey: true, altKey: true }, WIN)).toBe(false)
  })

  it('leaves Ctrl+R alone so browser reload keeps working', () => {
    const reload: KeyLike = { key: 'r', ctrlKey: true }
    expect(isUndo(reload, WIN)).toBe(false)
    expect(isRedo(reload, WIN)).toBe(false)
  })

  // Undo inside a prompt box should undo typing, not the whole canvas.
  it('recognises fields where the browser should keep its own undo', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'input' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(
      isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

})
