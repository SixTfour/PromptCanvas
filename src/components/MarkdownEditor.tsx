import { useRef, useState } from 'react'
import {
  type EditResult,
  insertLink,
  textStats,
  toggleLinePrefix,
  toggleOrderedList,
  toggleWrap,
} from '../lib/markdown'
import { Markdown } from './Markdown'

/**
 * A markdown editor for prompt text.
 *
 * Hand-rolled rather than pulled in as a package: the blocks being edited are
 * short, the surrounding palette is custom, and every off-the-shelf editor
 * arrives with its own theme to fight. What is actually wanted is a textarea
 * that keeps your caret where you left it, a few shortcuts, and a way to check
 * how the markdown will land.
 */

type Action =
  | { kind: 'wrap'; marker: string }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'ol' }
  | { kind: 'link' }

const TOOLS: Array<{ label: string; title: string; action: Action; mono?: boolean }> = [
  { label: 'B', title: 'Bold  (Ctrl+B)', action: { kind: 'wrap', marker: '**' } },
  { label: 'I', title: 'Italic  (Ctrl+I)', action: { kind: 'wrap', marker: '*' } },
  { label: '</>', title: 'Inline code', action: { kind: 'wrap', marker: '`' }, mono: true },
  { label: 'H', title: 'Heading', action: { kind: 'prefix', prefix: '## ' } },
  { label: '•', title: 'Bullet list', action: { kind: 'prefix', prefix: '- ' } },
  { label: '1.', title: 'Numbered list', action: { kind: 'ol' } },
  { label: '"', title: 'Quote', action: { kind: 'prefix', prefix: '> ' } },
  { label: '🔗', title: 'Link  (Ctrl+K)', action: { kind: 'link' } },
]

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 4,
  /** Hides the preview toggle where a block is too small to warrant one. */
  allowPreview = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  allowPreview?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  const apply = (action: Action) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el

    let result: EditResult
    switch (action.kind) {
      case 'wrap':
        result = toggleWrap(value, s, e, action.marker)
        break
      case 'prefix':
        result = toggleLinePrefix(value, s, e, action.prefix)
        break
      case 'ol':
        result = toggleOrderedList(value, s, e)
        break
      case 'link':
        result = insertLink(value, s, e)
        break
    }

    onChange(result.text)
    // React has not re-rendered yet, so restore the selection on the next frame
    // or the caret snaps to the end of the textarea.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.start, result.end)
    })
  }

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(ev.ctrlKey || ev.metaKey)) return
    const key = ev.key.toLowerCase()
    const shortcut: Record<string, Action> = {
      b: { kind: 'wrap', marker: '**' },
      i: { kind: 'wrap', marker: '*' },
      k: { kind: 'link' },
    }
    if (shortcut[key]) {
      ev.preventDefault()
      apply(shortcut[key])
    }
  }

  const stats = textStats(value)

  return (
    <div className="rounded-md border border-[var(--color-edge)] bg-[var(--color-canvas)] focus-within:border-[var(--color-accent)]">
      <div className="flex items-center gap-0.5 border-b border-[var(--color-edge)] px-1 py-1">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.title}
            // Keep focus in the textarea so the selection survives the click.
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => apply(t.action)}
            disabled={preview}
            className={`rounded px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)] disabled:opacity-30 ${
              t.mono ? 'font-mono' : ''
            } ${t.label === 'B' ? 'font-bold' : ''} ${t.label === 'I' ? 'italic' : ''}`}
          >
            {t.label}
          </button>
        ))}
        {allowPreview && (
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${
              preview
                ? 'bg-[var(--color-accent)] text-[#0b0d12]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-edge)] hover:text-[var(--color-ink)]'
            }`}
          >
            preview
          </button>
        )}
      </div>

      {preview ? (
        <div
          className="px-2.5 py-2 text-[13px] leading-relaxed text-[var(--color-ink)]"
          style={{ minHeight: rows * 22 }}
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <span className="text-[#5a6175]">Nothing to preview.</span>
          )}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck
          className="w-full resize-y bg-transparent px-2.5 py-2 text-[13px] leading-relaxed text-[var(--color-ink)] placeholder:text-[#5a6175] focus:outline-none"
        />
      )}

      <div className="flex items-center gap-2 border-t border-[var(--color-edge)] px-2.5 py-1 text-[10px] text-[#5a6175]">
        <span>
          {stats.words} {stats.words === 1 ? 'word' : 'words'}
        </span>
        <span>·</span>
        <span>{stats.chars} chars</span>
        <span className="ml-auto">markdown</span>
      </div>
    </div>
  )
}
