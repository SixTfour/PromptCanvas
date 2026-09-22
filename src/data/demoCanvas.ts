import { DEFAULT_MODEL } from '../lib/models'
import type { Canvas } from '../types'

/**
 * The bundled demo canvas.
 *
 * These are **curated reference outputs**, written to show what a good answer
 * to each prompt looks like. They are deliberately not what SmolLM produces —
 * a 135M model cannot write these. The point of demo mode is to teach the
 * workflow (branch, compare, diff, merge) with legible material; switch to
 * Local mode to see what the model on your machine actually does with the same
 * prompts. The UI labels every demo run as a sample for exactly this reason.
 *
 * The scenario is a real prompt-engineering loop: a first attempt that is
 * technically correct but unusable, two trace corrections that each fix one
 * thing and break nothing, and a merge that takes the good parts of both.
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

const ROOT_RESPONSE = `Based on the customer's message, this appears to be a checkout failure affecting mobile Safari users. Let me work through what we know and what it implies.

The customer, Dana Okafor, is reporting that they are unable to complete an order on their mobile device. The issue began yesterday, which suggests a recent change may be responsible. They describe being able to add items to their basket without difficulty, and they are able to reach the checkout page and enter their payment card details. The failure occurs at the point of submission — when the "Pay Now" button is pressed, the page enters an indefinite loading state and eventually renders a blank white screen.

It is worth noting that the customer attempted the transaction twice, using two different payment cards, and encountered identical behaviour on both occasions. This is a useful signal because it tends to rule out a card-specific decline or an issuer-side problem, and points instead toward something in the application itself.

The customer also mentions that a colleague using an Android device does not experience the problem. Combined with the fact that the customer is on an iPhone 14 running Safari, this suggests the issue may be specific to the Safari browser or to iOS more generally, rather than being a universal checkout outage.

The customer notes that the checkout flow worked as expected last week, reinforcing the hypothesis that a recent deployment introduced the regression.

Finally, the customer has helpfully supplied an order reference from one of the failed attempts, NW-88213, which the team should be able to use to locate the corresponding server-side logs and trace the request.

The customer has indicated that this is blocking their store from taking orders, which they describe as fairly urgent.

Recommended next steps would include pulling the logs for the referenced order, reviewing recent deployments to the checkout service, and attempting to reproduce the failure on an iOS Safari device or simulator.`

const TERSE_RESPONSE = `**Title:** Checkout hangs then blanks on submit — iOS Safari

**Reported by:** dana.okafor@northwind-retail.example
**Order ref:** NW-88213

**Steps to reproduce**
1. On iPhone 14 / Safari, add any item to basket
2. Proceed to checkout, enter valid card details
3. Tap "Pay Now"

**Expected:** Order is placed and a confirmation is shown.
**Actual:** Page spins indefinitely, then renders blank white.

**Scope**
- Reproduced twice, with two different cards → not card- or issuer-specific
- Android user on same store unaffected → likely iOS/Safari-specific
- Working as of last week → suspect a recent deploy

**Suggested first steps**
- Pull server logs for NW-88213
- Diff checkout-service deploys from the last 48h
- Reproduce on iOS Safari (real device — the simulator does not reproduce WebKit payment quirks reliably)`

const SEVERITY_RESPONSE = `**Title:** Mobile Safari checkout fails at payment submission

**Severity: S1 — revenue-blocking**
Justification: the customer states this is preventing their store from taking orders. There is no workaround on the affected platform, and mobile Safari is a substantial share of retail traffic. Revenue loss is ongoing and accrues for as long as the defect is live.

**Reporter:** dana.okafor@northwind-retail.example (Northwind Retail)
**Order reference:** NW-88213

**Summary**
Since approximately one day ago, customers on iOS Safari cannot complete checkout. Basket and checkout pages load normally; the failure occurs on submission. The page hangs indefinitely and then renders blank.

**Evidence and scope**
- Two attempts, two distinct cards, identical failure → not a payment-instrument or issuer decline
- A colleague on Android is unaffected → platform-specific, not a full outage
- Flow worked one week ago → regression, most likely deploy-induced

**Confidence:** Medium-high on iOS Safari scoping (single reporter, single counter-example). Should be confirmed against error rates segmented by user agent before the scope is treated as settled.

**Immediate actions**
1. Check checkout error rate by user agent for the last 72h — confirms or kills the iOS hypothesis in minutes
2. Retrieve the server-side trace for NW-88213
3. Identify checkout-path deploys in the same window and consider a rollback`

const MERGED_RESPONSE = `**Title:** Checkout hangs then blanks on submit — iOS Safari

**Severity: S1 — revenue-blocking.** Customer reports their store cannot take orders; no workaround on the affected platform.

**Reporter:** dana.okafor@northwind-retail.example
**Order ref:** NW-88213

**Steps to reproduce**
1. On iPhone 14 / Safari, add any item to basket
2. Proceed to checkout, enter valid card details
3. Tap "Pay Now"

**Expected:** Order placed, confirmation shown.
**Actual:** Indefinite spinner, then blank white page.

**Scope**
- Two attempts, two cards, identical failure → not card- or issuer-specific
- Android user unaffected → likely iOS/Safari-specific
- Worked one week ago → regression, probably deploy-induced

**Confidence:** Medium-high on the iOS scoping — one reporter, one counter-example. Confirm against user-agent-segmented error rates before treating it as settled.

**First steps**
1. Checkout error rate by user agent, last 72h — confirms or kills the iOS hypothesis in minutes
2. Server trace for NW-88213
3. Diff checkout-path deploys in the window; consider rollback`

export function buildDemoCanvas(): Canvas {
  const now = Date.now()
  return {
    id: 'demo-triage',
    name: 'Sample — bug report triage',
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
          instruction:
            'Turn the bug report into a triaged engineering ticket.',
          blocks: [
            {
              id: 'b-report',
              label: 'Bug report',
              kind: 'context',
              enabled: true,
              text: BUG_REPORT,
            },
          ],
          model: DEFAULT_MODEL,
          maxNewTokens: 256,
          runs: [
            {
              id: 'r-root-1',
              status: 'done',
              text: ROOT_RESPONSE,
              model: DEFAULT_MODEL,
              demo: true,
              startedAt: now,
              finishedAt: now + 9400,
            },
          ],
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
              text: `The previous attempt buried the reproduction steps inside three paragraphs of prose. An on-call engineer reads this at 2am on a phone.

Produce a scannable ticket: a title, numbered reproduction steps, explicit expected vs actual, and a short bulleted scope section. No narrative paragraphs. Do not restate the customer's message back to them.`,
            },
          ],
          model: DEFAULT_MODEL,
          maxNewTokens: 256,
          runs: [
            {
              id: 'r-terse-1',
              status: 'done',
              text: TERSE_RESPONSE,
              model: DEFAULT_MODEL,
              demo: true,
              startedAt: now,
              finishedAt: now + 6100,
            },
            {
              id: 'r-terse-2',
              status: 'done',
              text: TERSE_RESPONSE.replace(
                '**Suggested first steps**',
                '**Where to look first**',
              ).replace('- Pull server logs for NW-88213', '- Server logs for NW-88213'),
              model: DEFAULT_MODEL,
              demo: true,
              startedAt: now,
              finishedAt: now + 5800,
            },
          ],
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
          runs: [
            {
              id: 'r-sev-1',
              status: 'done',
              text: SEVERITY_RESPONSE,
              model: DEFAULT_MODEL,
              demo: true,
              startedAt: now,
              finishedAt: now + 8200,
            },
          ],
        },
      },
      {
        id: 'n-merged',
        type: 'merge',
        position: { x: 0, y: 0 },
        data: {
          title: 'Merged: scannable + severity',
          mergedFrom: ['n-terse', 'n-severity'],
          blocks: [
            {
              id: 'b-merged',
              label: 'merged correction',
              kind: 'correction',
              enabled: true,
              text: `Produce a scannable ticket: title, numbered reproduction steps, explicit expected vs actual, short bulleted scope. No narrative paragraphs; do not restate the customer's message.

Open with an explicit severity and one sentence justifying it. Where evidence is thin, state your confidence and name the single cheapest check that would confirm or kill the hypothesis.`,
            },
          ],
          model: DEFAULT_MODEL,
          maxNewTokens: 256,
          runs: [
            {
              id: 'r-merged-1',
              status: 'done',
              text: MERGED_RESPONSE,
              model: DEFAULT_MODEL,
              demo: true,
              startedAt: now,
              finishedAt: now + 6700,
            },
          ],
        },
      },
    ],
    edges: [
      { id: 'e-root-terse', source: 'n-root', target: 'n-terse', kind: 'branch' },
      { id: 'e-root-sev', source: 'n-root', target: 'n-severity', kind: 'branch' },
      { id: 'e-terse-merged', source: 'n-terse', target: 'n-merged', kind: 'merge' },
      { id: 'e-sev-merged', source: 'n-severity', target: 'n-merged', kind: 'merge' },
    ],
  }
}

/**
 * Canned responses for demo runs on nodes the dataset does not cover.
 *
 * Demo mode has to answer the question "what happens when I edit a prompt and
 * press Run?" The honest answer is that there is no pre-generated response for a
 * prompt nobody anticipated, so the app says so in the run itself rather than
 * inventing a result that would misrepresent what the model does.
 */
export function demoResponseFor(promptText: string): string | null {
  const t = promptText.toLowerCase()
  if (t.includes('scannable') && t.includes('severity')) return MERGED_RESPONSE
  if (t.includes('scannable')) return TERSE_RESPONSE
  if (t.includes('severity')) return SEVERITY_RESPONSE
  if (t.includes('nw-88213')) return ROOT_RESPONSE
  return null
}

export const DEMO_UNAVAILABLE_NOTICE =
  'Sample mode has no curated response for this prompt.\n\nThe bundled dataset covers the baseline, the two corrections, and the merge. Revert your edit to see it again, or switch to Local mode to actually generate an answer for this one.'
