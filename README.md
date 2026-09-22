# Prompt Canvas

A graph editor for prompt engineering. Instead of a linear chat, prompts live on
a canvas: you branch off a node by adding a context snippet or a trace
correction, run the branches, compare their outputs side by side, and merge the
best parts of two branches into a new prompt.

**No API key. No account. No cost.** The model runs in your browser.

## Why a graph

Prompt engineering is not linear, but chat UIs are. You try something, it is 80%
right, you fix the one thing that was wrong — and now the earlier version is
buried in scrollback and you cannot compare them. Branching makes each attempt a
node you can return to, run again, and diff against its siblings.

The canvas is a **DAG, not a tree**: merging two branches creates a new node with
two incoming edges. Neither parent is modified and no history is destroyed.

Output is rendered as **markdown**, because small instruct models emit it
whether or not you ask — headings, bold labels, numbered steps — and showing
`**Severity:**` literally made the one thing you are there to read the hardest
thing on screen. Prompt text is edited in a **markdown editor** with a
formatting toolbar, Ctrl+B/I/K shortcuts and a preview toggle. Raw HTML is not
enabled in the renderer: model output is untrusted text.

Each node on the canvas leads with its **generated text** — that is the only
high-contrast type on the card, with the title, counters and actions sized to
stay out of its way. The inspector opens on Output for any node that has been
run. The prompt that produced it is one tab away, because the thing you spend
your time reading is the answer, not the instruction.

## The model

A node is a **composed prompt spec**, not a chat turn:

```
ROOT
  system:      "You are an engineering triage assistant."
  context:     <the raw bug report>
  instruction: "Turn this into a triaged ticket."
   |
   ├── "Correction: scannable"   + correction block
   │
   └── "Correction: severity"    + correction block
         |
         ▼
     [MERGE] ── new node, two incoming edges
```

The prompt is built by walking root → node and concatenating every enabled block
along the way. That is what makes Diff & Merge meaningful: you are diffing
structured prompt text, not dialogue.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 126 tests over DAG, composition, diff, context budget and errors
npm run build
```

Node 20+ to develop. To *use* it you need a current Chrome, Edge or Firefox —
Safari's support for the runtime is partial.

**Hardware acceleration must be on.** Chrome only exposes WebGPU when "Use
graphics acceleration when available" is enabled in `chrome://settings/system`;
with it off, `requestAdapter()` returns null and everything falls back to the
CPU. The app probes for this before downloading anything and says so, with the
setting path, rather than letting you fetch several hundred megabytes and then
wonder why generation crawls. `chrome://gpu` should report
"WebGPU: Hardware accelerated".

## Getting started

On first load Prompt Canvas asks which model you want and downloads it. Weights
come from Hugging Face once, are cached by the browser, and then run on your
machine via [transformers.js](https://github.com/huggingface/transformers.js) —
WebGPU where available, CPU otherwise. After that it works offline and your
prompts never leave the browser.

You land on a starter canvas: a baseline prompt plus two competing trace
corrections, ready to run, compare and merge. Nothing on it is pre-generated —
every output you see was produced by the model on your machine. **New** clears
it and **Reset** brings it back.

**Models** manages what is on disk. Each row shows a live download progress bar
with real byte counts while it fetches, what the model actually occupies once
cached (measured, not estimated), and a **Delete** button that evicts its
weights and tells you how much it reclaimed. Deleting the model currently in use
disposes it first, so you are never left with a session that works until reload
and then mysteriously does not. The dialog also reports total storage used,
since weights and saved canvases share one browser quota.

## The models

| Model | Download | Context | Notes |
|---|---|---|---|
| **SmolLM 135M** (default) | ~270 MB | 2,048 tok | Fastest, weakest. fp16 rather than 4-bit, because quantisation measurably hurts a model this small. |
| SmolLM2 360M | ~290 MB | 8,192 tok | Steadier, and 4× the context for about the same download. |
| SmolLM2 1.7B | ~1.1 GB | 8,192 tok | The only one that holds a structured format reliably. Wants WebGPU. |

### Set your expectations

These are 135M–1.7B parameter models. The default is roughly a thousandth the
size of a frontier model, and it shows. Asked *"You are a triage assistant.
Summarise: the app crashes on submit,"* SmolLM-135M replied:

> *"The triage assistant, also known as the 'assistant to the user,' is a tool
> that helps triage users in a hospital or healthcare facility..."*

It ignored the task and free-associated about hospital triage. The model card
itself notes it struggles with arithmetic, editing and multi-step reasoning.

**This is the honest trade for "free and private."** Prompt Canvas is still
genuinely useful here — branching, diffing and merging all work, and a small
model is unusually *sensitive* to wording, so the effect of a prompt change is
often more visible than it would be on a model smart enough to guess your intent
regardless. Just do not read its answers as authoritative.

If you want output worth reading rather than just worth comparing, download
SmolLM2 1.7B from the Models dialog.

### Context is the constraint

Money is no longer the limiting resource — context is. SmolLM 135M has a
**2,048-token window shared by the prompt and the completion**, and Prompt Canvas
composes prompts by concatenating every ancestor's blocks, so a deep branch grows
monotonically toward that ceiling.

Response length defaults to **the model's own maximum, minus whatever the
prompt has taken** — recomputed from the real token count on every run rather
than from an estimate. That keeps a branch in range as its ancestry grows, which
a fixed number does not.

A length you set by hand is treated as a *cap*, not a demand: it is lowered to
fit when the prompt grows, and applies again once the branch is shorter. A
number chosen on a shallow branch should not start truncating prompts three
corrections later.

Under **Advanced settings** the inspector shows the window broken into prompt
and response, warns as it fills, and disables **Run** on overflow — overflow is
*silent truncation*, not an error. You can pin an explicit length there too,
for output deliberately shorter than it could be. Deep lineages want SmolLM2 and
its 8k window.

### One upside

Generation is greedy (`do_sample: false`), so re-running an unchanged prompt
returns identical text. A/B comparison between branches is genuinely
reproducible, which it is not against a hosted API with no seed.

## Undo

`Ctrl+Z` / `Cmd+Z` undoes, `Ctrl+Y` or `Ctrl+Shift+Z` / `Cmd+Shift+Z` redoes,
and both are in the toolbar. Runs of related edits collapse into one step, so
typing a prompt is a single undo rather than one per keystroke, and dragging a
node is one rather than one per frame.

Undo never destroys generated text: a node that still exists keeps whatever it
has produced since, and a node restored from a delete gets its own output back.

Inside a text field the browser's own undo is left alone — rolling the whole
canvas back mid-sentence would be worse than useless.

`Ctrl+R` is deliberately not bound. It is browser reload, which this app needs,
since reloading is how you restart the inference worker.

## Diff & Merge

Pin exactly two branches to the compare tray and hit **Diff & Merge**.

The compare view is **side by side and phrase-aligned**. A removal immediately
followed by an addition is treated as a rewrite, so the two versions of a
reworded line sit on one row you read across, with word-level highlighting
confined to that row. Each column shows only its own side's markers, so both
read as prose rather than as a merge conflict. There is an "only changes" filter
and an inline view for when a single word changed.

Two ways to build the merged prompt:

- **Pick phrases** — deterministic and exact. Phrases both branches share are
  selected by default; contested ones are yours to choose. Merging works at
  phrase granularity because word-level merging produces grammatical rubble.
- **Synthesise with the model** — hands both prompts and both outputs to the
  local model and asks for a single stronger prompt. The meta-prompt is in
  [`src/lib/diff.ts`](src/lib/diff.ts), visible and editable. On a 135M model
  expect this to be weak; picking phrases is the reliable path.

## Privacy

There is no backend. Weights are fetched from `huggingface.co` on first use and
cached; after that nothing is sent anywhere. Your prompts, your canvases and your
outputs stay in the browser. The CSP in `vercel.json` restricts `connect-src` to
the Hugging Face CDN and nothing else.

## Sessions

Every canvas is saved as you work, and the one you had open is restored when you
come back — refreshing to restart the inference worker no longer costs you the
canvas. A collapsible **left rail** lists what is saved. The open session is pinned to
the top; everything else is ordered by when it was last edited or run, with the
node and generation counts that tell you which one you actually want. Open, duplicate or
delete one from there, or start a new session. Collapsed it stays as a narrow
strip rather than vanishing, and the state is remembered.

The session id is shown next to the name in the header and on every sidebar
row, so the canvas on screen can be matched to a row in the list or to the
`?session=` in the address bar. Clicking the one in the header copies it.

Each session has an address: `?session=<id>`. Bookmark it to come back to a
specific canvas, and browser Back and Forward move between the sessions you have
opened. The **link** action on a session copies its URL.

It is an address, not a share link — the id names a record in *this* browser's
IndexedDB, so the same URL opened on another machine finds nothing and says so
rather than failing quietly. Export is still how a canvas travels.

Search covers **prompt text as well as names**, because most sessions keep
whatever name the starter gave them and the name alone rarely tells them apart.
Terms are ANDed, so typing more narrows the list, and a session found only by
its contents says so.

Sessions live in IndexedDB — localStorage's ~5 MB ceiling is both small for a
few dozen responses and, when you hit it, a silent quota exception mid-write.
They are per browser: another browser or machine will not see them, and clearing
site data removes them along with any cached model weights. **Export** writes a
`promptcanvas.v1` JSON file, which is also the format the starter canvas uses,
so there is one schema rather than two that drift.

Cached model weights and saved canvases share the same browser storage quota.

## Deploying to Vercel

```bash
npm i -g vercel
vercel
```

Pure static build — no serverless functions, no environment variables, no
secrets. `vercel.json` sets the SPA rewrite, security headers, and a CSP that
permits WebAssembly and the Hugging Face CDN.

Be aware the build includes the ONNX Runtime WebAssembly binary (~27 MB, ~6.8 MB
gzipped). It is only fetched when a visitor actually runs a model on the CPU
path, not on page load.

## Layout

```
src/
  lib/
    models.ts             model registry, sizes, context budget helper
    engine.ts             main-thread client: load progress, serial run queue
    inference.worker.ts   transformers.js inference, off the main thread
    compose.ts            DAG walking, root→node prompt composition
    diff.ts               word- and phrase-level diff, merge assembly, meta-prompt
    layout.ts             dagre auto-layout (handles two-parent merges)
    keys.ts               platform-aware shortcut matching
    number.ts             committing typed numbers without fighting the caret
    prefs.ts              remembered view preferences, validated on read
    search.ts             session search over names and prompt text
    url.ts                ?session= addressing, parsed and rewritten purely
    time.ts               relative timestamps for the session list
    markdown.ts           toolbar text transforms (pure, so they are testable)
    storage.ts            IndexedDB persistence, export/import
    errors.ts             OOM / WebGPU / download failures in plain English
    core.test.ts          tests for the above
  components/             canvas, inspector, compare tray, diff & merge, toolbar
  store/                  zustand store
  data/                   starter canvas (prompts only, no outputs)
```

Inference runs in a Web Worker. On the CPU path generation is a tight
synchronous loop that would otherwise freeze the canvas completely — no panning,
no streaming repaint, and a Stop button that does nothing.

Runs are **serialised**: there is one model in one worker and `generate` is not
reentrant, so firing two at once interleaves their decode loops and corrupts
both. Against a hosted API you would fan out; here everything queues.

## Known gaps

- Only SmolLM models. An OpenAI-compatible adapter would let you point at Ollama
  or LM Studio for a real model locally; not built.
- No shared-link sharing; export/import is the transport.
- Desktop-oriented — the three-pane layout does not collapse for phones.
- The synthesis meta-prompt was written for a capable model and has not been
  re-tuned for a small one.

## Licence

MIT. Model weights are licensed separately by their authors — SmolLM is Apache
2.0.
