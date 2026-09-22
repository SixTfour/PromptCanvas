import { nanoid } from 'nanoid'
import { DEFAULT_MODEL } from '../lib/models'
import type { Canvas } from '../types'

/**
 * The canvas a new session opens on.
 *
 * This is a *scaffold*, not a demo: real prompts with no outputs attached.
 * Nothing here is pre-generated, so whatever appears on screen was produced by
 * the model on this machine. Dropping someone onto a blank canvas would make
 * them invent a scenario before they could try the tool, so the starter sets up
 * one worth branching — a baseline plus two competing trace corrections, ready
 * to run, compare and merge.
 *
 * Delete it with "New" at any time.
 */

const BUG_REPORT = `From: dana.okafor@northwind-retail.example
Subject: cant check out on mobile??

hi - since yesterday i cannot complete an order on my phone. i add things to
the basket fine, go to checkout, fill in the card details and then when i press
Pay Now the page just spins forever. eventually it goes white. tried twice with
two different cards, same thing. my colleague on android says it works for him.
i am on an iphone 14, safari. it worked last week. this is blocking our store
from taking orders so its fairly urgent. order ref from the failed attempt is
NW-88213 if that helps.`

/**
 * `id` is passed in when resetting an existing session, so the reset replaces
 * that session's content rather than spawning a new saved canvas beside it.
 */
export function buildStarterCanvas(id?: string): Canvas {
  const now = Date.now()
  return {
    id: id ?? `c-${nanoid(8)}`,
    name: 'Bug report triage',
    rootId: 'n-root',
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: 'n-root',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          title: 'Baseline',
          system:
            'You are an engineering triage assistant. You turn raw customer bug reports into tickets that an on-call engineer can act on immediately.',
          instruction: 'Turn the bug report into a triaged engineering ticket.',
          blocks: [
            { id: 'b-report', label: 'Bug report', kind: 'context', enabled: true, text: BUG_REPORT },
          ],
          model: DEFAULT_MODEL,
          maxNewTokens: 256,
          runs: [],
        },
      },
      {
        id: 'n-terse',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          title: 'Correction: scannable',
          blocks: [
            {
              id: 'b-terse',
              label: 'correction: scannable',
              kind: 'correction',
              enabled: true,
              text: `The previous attempt buried the reproduction steps inside paragraphs of prose. An on-call engineer reads this at 2am on a phone.

Produce a scannable ticket: a title, numbered reproduction steps, explicit expected vs actual, and a short bulleted scope section. No narrative paragraphs. Do not restate the customer's message back to them.`,
            },
          ],
          model: DEFAULT_MODEL,
          maxNewTokens: 256,
          runs: [],
        },
      },
      {
        id: 'n-severity',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          title: 'Correction: severity',
          blocks: [
            {
              id: 'b-sev',
              label: 'correction: severity',
              kind: 'correction',
              enabled: true,
              text: `The previous attempt never assigned a severity, so the ticket sat in the backlog for two days while the customer could not take orders.

Always open with an explicit severity and one sentence justifying it. Where the evidence is thin, say how confident you are and name the single cheapest check that would confirm or kill the hypothesis.`,
            },
          ],
          model: DEFAULT_MODEL,
          maxNewTokens: 256,
          runs: [],
        },
      },
    ],
    edges: [
      { id: 'e-root-terse', source: 'n-root', target: 'n-terse', kind: 'branch' },
      { id: 'e-root-sev', source: 'n-root', target: 'n-severity', kind: 'branch' },
    ],
  }
}
