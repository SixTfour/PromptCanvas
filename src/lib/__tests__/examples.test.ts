import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { composePrompt } from '../compose'
import { contextPressure, estimateTokens } from '../models'
import { importCanvas } from '../storage'

/*
 * The bundled example is a file nothing in the app imports, so a schema change
 * would break it silently and it would only be discovered in front of someone.
 */
describe('the bundled example canvas', () => {
  const canvas = importCanvas(
    readFileSync('examples/authoring-a-claude-skill.json', 'utf-8'),
  )

  it('imports as a branchable canvas', () => {
    expect(canvas.rootId).toBe('n-root')
    // A root and two competing corrections: the shape the demo walks through.
    expect(canvas.nodes).toHaveLength(3)
    expect(canvas.edges.filter((e) => e.source === canvas.rootId)).toHaveLength(2)
  })

  it('composes every branch well inside its window', () => {
    for (const n of canvas.nodes) {
      const c = composePrompt(canvas, n.id)
      const tokens = estimateTokens(c.text) + estimateTokens(c.system)
      expect(contextPressure(n.data.model, tokens, 256).level, n.id).toBe('ok')
    }
  })
})
