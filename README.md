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
along the way, each under its own `##` heading, with the task emitted at the node
that declares it so descendant blocks land after the thing they amend. That is
what makes Diff & Merge meaningful: you are diffing structured prompt text, not
dialogue.

A block is one of two things, and the choice is the only setting in the panel
that changes what the model receives:

- **context** — material to read. Sent as written, under its heading.
- **correction** — an instruction to obey. Sent with a line telling the model it
  overrides anything above it that conflicts.

(There was a third, `example`, which rendered under a different heading and was
otherwise identical to `context`. It was removed rather than left as a control
with no effect; saved canvases holding one migrate to `context` on load, keeping
the heading.)

That override line earns its place. Asked to plan a trip and then corrected to
depart from a different airport, SmolLM2 1.7B ignored the correction under a bare
`## correction` heading, under a more directive heading, with the correction moved
ahead of the task, and with it folded into the task itself — and honoured it only
once the block said plainly that it overrode what came before. The injection is
visible rather than magic: the Composed tab shows the prompt verbatim.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 182 tests over DAG, composition, diff, context budget and errors
npm run build
```

Node 20+ to develop. To *use* it you need a current Chrome, Edge or Firefox —
Safari's support for the runtime is partial.

**Hardware acceleration must be on.** Chrome only exposes WebGPU when "Use
graphics acceleration when available" is enabled in `chrome://settings/system`;
with it off, `requestAdapter()` returns null and everything falls back to the
CPU. On a first visit the Models dialog probes for this before downloading
anything and names the setting, rather than letting you fetch a few hundred
megabytes and then wonder why generation crawls. On later visits the dialog does
not open by itself, so the only hint is the `CPU` marker in the toolbar — open
**Models** to be told why. `chrome://gpu` should report
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
| **SmolLM 135M** (default) | ~115 MB | 2,048 tok | Fastest and weakest, and the cheapest thing to try first. |
| SmolLM2 360M | ~260 MB | 8,192 tok | Steadier, with 4× the context. |
| SmolLM2 1.7B | ~1.1 GB | 8,192 tok | The only one that holds a structured format reliably. Wants a GPU. |

Sizes are for the variant a GPU gets (`q4f16`); the CPU variant (`q8`) is
somewhat larger. Each model lists variants in preference order and the loader
keeps the first that **provably generates** — a backend that cannot execute a
variant does not raise an error, it loads, runs, and returns nothing, so the
only dependable test is to ask for a few tokens and look at them.

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

Only **corrections** are merged. Flattening every block into one string diffed
one branch's source material against the other's instructions and wrote the
result back as a single correction — so a context block came out the far side as
something the model was told to obey, override line and all. Context blocks are
instead carried into the merged node unchanged, de-duplicated where both branches
hold the same material, and placed ahead of the merged correction so it reads as
an amendment to them. They cannot simply be left behind, because of what follows.

Either way the merge is built from the two branches' *own* blocks, so the merged
node supersedes them: composing its prompt skips the source nodes' blocks and
keeps the merged one. Without that, the merged prompt would carry both
corrections **and** the reconciliation of them — handing the model the exact
disagreement the merge existed to settle. Everything above the fork is untouched,
because the merge never saw it, and both branches stay runnable on their own.

Which makes a merge a snapshot, and snapshots go stale. Edit a branch afterwards
and the merged node keeps generating from text that no longer matches its parent,
with nothing in the prompt to reveal it — precisely because the merge supersedes
that branch. So each merge records a fingerprint of what it consumed
([`src/lib/merge.ts`](src/lib/merge.ts)); when a branch's blocks no longer match
it, the node shows an **out of date** badge and the inspector names the branch
that moved, with a **Rebuild from current branches** button. That re-pins the two
branches in the compare tray and re-opens the same Diff & Merge dialog, except
the result overwrites the existing merge instead of adding a second one beside
it: the node keeps its id, position, edges, title and run history, and the merged
block keeps its heading, so anything branched off the merge stays attached. A
merge whose branch has since been deleted cannot be rebuilt and says so, rather
than quietly merging against one parent.

Merges made before this was recorded get a fingerprint on next load: a merge that
was already stale is recorded as current, which is a guess, but flagging every
old canvas would be equally untrue and much noisier.

## Privacy

There is no backend. Weights are fetched from `huggingface.co` on first use and
cached; the model runtime is served from this origin rather than a CDN, so after
that first download nothing is requested from anywhere. Your prompts, your canvases and your
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

The ONNX Runtime is **served from this origin**, not from a CDN. Left to
itself, onnxruntime-web dynamically imports its runtime from jsDelivr the first
time a model loads: fine on a dev server with no CSP, refused on a deployed
build with one, and a third-party request on every cold start besides. A
prebuild step copies the runtime out of `node_modules` into `public/ort/`, so
the files always match the installed version and nothing is fetched from a
third party.

Be aware the build carries the ONNX Runtime WebAssembly binary (~25 MB, ~6.8 MB
gzipped), fetched the first time a model runs rather than on page load. It is
currently emitted twice — once at `/ort/`, which is what the app loads, and once
into `/assets/` by the bundler, which nothing reads. See Known gaps.

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
    merge.ts              merge fingerprints and rebuilds, so a merge knows it is stale
    keys.ts               platform-aware shortcut matching
    number.ts             committing typed numbers without fighting the caret
    prefs.ts              remembered view preferences, validated on read
    runs.ts               run ordering, collapse rules and previews
    search.ts             session search over names and prompt text
    url.ts                ?session= addressing, parsed and rewritten purely
    time.ts               relative timestamps for the session list
    markdown.ts           toolbar text transforms (pure, so they are testable)
    storage.ts            IndexedDB persistence, export/import
    errors.ts             OOM / WebGPU / download failures in plain English
    backend.ts            WebGPU probe and the advice shown when it is missing
    __tests__/            one test file per module above
  components/             canvas, inspector, compare tray, diff & merge, toolbar
  store/                  zustand store
  data/                   starter canvas (prompts only, no outputs)
  test/                   canvas fixtures shared across test files
scripts/
  copy-ort.mjs            puts the ONNX Runtime in public/ort/ before a build
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
- The ONNX Runtime ships twice: `/ort/` (used) and `/assets/` (dead weight the
  bundler emits from transformers.js's own reference). Costs ~25 MB of deploy
  size and nothing else.
- The hardware-acceleration warning only opens by itself on a first visit. Turn
  acceleration off later and the only signal is a `CPU` marker that is not
  styled as a problem.
- Session links are addresses, not shares: they only resolve in the browser that
  created the session. Export/import is the transport between machines.
- Desktop-oriented — the three-pane layout does not collapse for phones.
- The synthesis meta-prompt was written for a capable model and has not been
  re-tuned for a small one.

## Licence

MIT. Model weights are licensed separately by their authors — SmolLM is Apache
2.0.
