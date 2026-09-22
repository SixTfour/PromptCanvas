import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renders model output as markdown.
 *
 * Small instruct models emit markdown whether or not you ask for it — headings,
 * bold labels, numbered steps — and showing `**Severity:**` literally made the
 * one thing this tool exists to read the hardest thing on screen.
 *
 * Raw HTML is deliberately not enabled. Model output is untrusted text, and
 * react-markdown ignores embedded HTML unless you add rehype-raw, so the safe
 * default is simply left alone.
 *
 * Styling is done with component overrides rather than a typography plugin:
 * these blocks are small, dense, and on a dark palette, and prose defaults are
 * tuned for none of those.
 */

const base: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1.5 text-[14px] font-semibold text-[var(--color-ink)] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-[13.5px] font-semibold text-[var(--color-ink)] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2.5 mb-1 text-[13px] font-semibold text-[var(--color-ink)] first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2.5 mb-1 text-[12.5px] font-semibold text-[var(--color-ink)] first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--color-ink)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[var(--color-accent)] underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-[var(--color-edge)] pl-2.5 text-[var(--color-muted)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2.5 border-[var(--color-edge)]" />,
  code: ({ children, className }) => {
    // react-markdown marks fenced blocks with a language- class; inline code has none.
    const fenced = /language-/.test(className ?? '')
    if (fenced) {
      return (
        <code className="block overflow-x-auto rounded bg-[var(--color-canvas)] p-2 font-mono text-[11.5px] leading-relaxed">
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-[var(--color-edge)] px-1 py-0.5 font-mono text-[11.5px]">
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--color-edge)] bg-[var(--color-canvas)] px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--color-edge)] px-2 py-1 align-top">{children}</td>
  ),
}

function MarkdownInner({
  children,
  className = '',
}: {
  children: string
  className?: string
}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={base}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownInner)
