import { describe, expect, it } from 'vitest'
import {
  insertLink,
  textStats,
  toggleLinePrefix,
  toggleOrderedList,
  toggleWrap,
} from '../markdown'

describe('markdown editor transforms', () => {
  it('wraps a selection and leaves the caret around the same words', () => {
    const r = toggleWrap('make this bold', 5, 9, '**')
    expect(r.text).toBe('make **this** bold')
    expect(r.text.slice(r.start, r.end)).toBe('this')
  })

  it('unwraps when the markers are inside the selection', () => {
    const r = toggleWrap('make **this** bold', 5, 13, '**')
    expect(r.text).toBe('make this bold')
    expect(r.text.slice(r.start, r.end)).toBe('this')
  })

  // Double-clicking a word selects the word, not its markers, so a second
  // press of Bold has to look outside the selection to undo the first.
  it('unwraps when the markers sit just outside the selection', () => {
    const r = toggleWrap('make **this** bold', 7, 11, '**')
    expect(r.text).toBe('make this bold')
    expect(r.text.slice(r.start, r.end)).toBe('this')
  })

  it('puts the caret between the markers when nothing is selected', () => {
    const r = toggleWrap('ab', 1, 1, '**')
    expect(r.text).toBe('a****b')
    expect(r.start).toBe(3)
    expect(r.end).toBe(3)
  })

  it('prefixes every line the selection touches', () => {
    const r = toggleLinePrefix('one\ntwo\nthree', 1, 6, '- ')
    expect(r.text).toBe('- one\n- two\nthree')
  })

  it('completes a partly prefixed selection instead of clearing it', () => {
    const r = toggleLinePrefix('- one\ntwo', 0, 9, '- ')
    expect(r.text).toBe('- - one\n- two')
  })

  it('removes the prefix only when every touched line has it', () => {
    const r = toggleLinePrefix('- one\n- two', 0, 11, '- ')
    expect(r.text).toBe('one\ntwo')
  })

  it('numbers lines from one and strips numbering again', () => {
    const on = toggleOrderedList('a\nb\nc', 0, 5)
    expect(on.text).toBe('1. a\n2. b\n3. c')
    const off = toggleOrderedList(on.text, on.start, on.end)
    expect(off.text).toBe('a\nb\nc')
  })

  it('keeps selected text as the link label and selects the url placeholder', () => {
    const r = insertLink('see docs here', 4, 8)
    expect(r.text).toBe('see [docs](url) here')
    expect(r.text.slice(r.start, r.end)).toBe('url')
  })

  it('counts words without being fooled by extra whitespace', () => {
    expect(textStats('  one   two \n three  ').words).toBe(3)
    expect(textStats('').words).toBe(0)
    expect(textStats('   ').words).toBe(0)
  })
})
