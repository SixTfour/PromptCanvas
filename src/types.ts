import type { ModelId } from './lib/models'

/**
 * Core data model.
 *
 * A canvas is a DAG, not a tree. A node normally has one parent (a *branch*),
 * but a merge node has two — that is how "synthesise the best of two children"
 * is represented without re-parenting anything.
 *
 * A node is a *composed prompt spec*, not a chat turn. The final prompt sent to
 * the model is built by walking root -> node and concatenating every ancestor's
 * context blocks, then appending this node's own instruction. That is what makes
 * Diff & Merge meaningful: you are diffing structured prompt text, not dialogue.
 */

export type { ModelId }

/** A single unit of prompt text. Inherited blocks come from ancestors. */
export interface ContextBlock {
  id: string
  /** Short human label shown on the node chip, e.g. "focus: perf". */
  label: string
  text: string
  /** A trace correction is the "here is what you got wrong" snippet that motivated the branch. */
  kind: 'context' | 'correction' | 'example'
  enabled: boolean
}

/** What one generation actually cost in time and tokens. No money is involved. */
export interface RunStats {
  promptTokens: number
  completionTokens: number
  elapsedMs: number
  tokensPerSecond: number
}

/**
 * One sample from the model for a node.
 *
 * Generation is greedy (`do_sample: false`), so re-running an unchanged prompt
 * gives the same text. That makes A/B comparison genuinely reproducible here,
 * which it is not against a hosted API with no seed. Multiple samples are still
 * supported for when sampling is enabled later.
 */
export interface Run {
  id: string
  status: 'idle' | 'loading' | 'streaming' | 'done' | 'error' | 'cancelled'
  text: string
  error?: string
  model: ModelId
  startedAt?: number
  finishedAt?: number
  stats?: RunStats
  /** True when the text came from the bundled sample dataset rather than the model. */
  demo?: boolean
}

export interface PromptNodeData extends Record<string, unknown> {
  title: string
  /** Only the root's system prompt is used; descendants inherit it. */
  system?: string
  /** Blocks this node contributes. Ancestors' blocks are prepended at compose time. */
  blocks: ContextBlock[]
  /** The final instruction. Inherited from the nearest ancestor that sets one. */
  instruction?: string
  model: ModelId
  /** Upper bound on generated tokens. Counts against the model's context window. */
  maxNewTokens: number
  runs: Run[]
  /** Set on nodes produced by Diff & Merge, for provenance in the UI. */
  mergedFrom?: [string, string]
  collapsed?: boolean
}

export type CanvasNodeType = 'prompt' | 'merge'

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: PromptNodeData
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  kind: 'branch' | 'merge'
}

export interface Canvas {
  id: string
  name: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  rootId: string
  createdAt: number
  updatedAt: number
}

/** What actually gets sent to the model. */
export interface ComposedPrompt {
  system: string
  /** Every enabled block from root down to (and including) this node. */
  blocks: Array<ContextBlock & { fromNodeId: string; inherited: boolean }>
  instruction: string
  /**
   * Number of leading blocks this node shares with its siblings. Used to show
   * how much of a branch is inherited rather than its own contribution.
   */
  sharedPrefixLength: number
  text: string
}

export type AppMode = 'demo' | 'local'
