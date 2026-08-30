# Cleanup batch — "the system asserts things it has not verified"

Four confirmed defects. One family: in each case a component reports an outcome
it never established. Every fix below is judged against a single test — *after
this change, can the system still claim something it did not check?*

Source of truth for every node name, id and position: the exports in
`/home/claude/audit/n8n-workflows/`. Nothing live was touched.

| # | Workflow | Workflow id | Ops file |
|---|---|---|---|
| 1, 2 | Ask-AI — RAG Query Agent | `qHAtd3RckAKRBUkE` | `OPERATIONS_askai.json` |
| 3a | WhatsApp BDC AI Agent | `BiyHk9ZXxJUVGbf6` | `OPERATIONS_deadnodes.json` → `whatsapp_bdc_ai_agent` |
| 3b | NEXUS Master Lead Router - AI Agent | `JnlZFAVmFAuNXVya` | `OPERATIONS_deadnodes.json` → `nexus_master_lead_router_ai_agent` |
| 4 | NEXUS Infra Health Probe | `57QpbNQGwlFKb0q3` | `OPERATIONS_probe.json` |

`OPERATIONS_deadnodes.json` is an **object**, not a bare array, because it spans
two workflows. Each value carries `workflowId` and an `operations` array that is
a valid MCP payload on its own. Apply as two `update_workflow` calls.

---

## 1 — Ask-AI's citations are decorative

### What is actually wrong

`Build RAG Context` builds `sources[]` from every row `search_rag_documents`
returned. `Format Response` copies that array straight through as `sources`. The
dashboard (`apps/executive-dashboard/screens/ask.js`) renders `res.sources` in a
panel headed **Sources**, numbered, with titles and page numbers, directly under
the answer.

So the list means *"retrieval returned these"* while the UI presents it as
*"the answer came from these"*. Those are different claims, and only the first
one is true. A free-tier model at `temperature: 0.3` that ignores the context
entirely and answers a refund question from its training data gets rendered
beside four real document titles and page numbers. A rep reads that as company
policy and repeats it to a customer.

Three aggravating factors, all real:

* `context.substring(0, 8000)` cut the tail sources out of the prompt **entirely**
  while still listing them as sources, and cut whichever source straddled
  character 8000 mid-sentence. Nothing downstream knew either had happened.
* Sources carried no row or chunk id, so nobody could pull the exact text fed in.
* The workflow instructed the model to *"cite which numbered source you used"* in
  prose, and then never looked at whether it had.

### The options, weighed honestly

**(A) Require citation markers and render only what the model named.**
Change the contract to `[S1]`-style markers, parse them, and let `sources` mean
only the blocks the model marked.
*Cost:* free-tier models emit markers unreliably, so some genuinely-grounded
answers will come back marked "uncited".
*Value:* the failure is in the safe direction. An uncited grounded answer costs
a rep thirty seconds of checking. A cited ungrounded answer costs a customer
dispute. And the parse is deterministic — no extra model call, no extra latency,
no extra CPU on a shared vCPU.

**(B) Verify claims against retrieved text.**
A second model pass, or an NLI/entailment check, asserting that each sentence is
supported.
*Rejected, and not narrowly.* The only verifier available here is another
free-tier model on the same 1-vCPU/958 MB box — a verifier no more reliable than
the thing it verifies, doubling latency inside a workflow whose caller already
gives up at 45 s (`DEADLINE_MS` in `ask.js`) and which occupies one of two
production slots while it runs. Worse, a verifier that says "verified" and is
wrong is a *new* instance of exactly the defect being fixed: one more component
asserting something it did not establish. Building it would make the system less
honest, not more.

**(C) Change what the UI asserts.**
Stop implying the answer is sourced.
*Necessary but not sufficient on its own.* Softening the wording while still
listing four documents under an ungrounded answer keeps the visual lie intact —
the panel is what a skimming rep reads, not the caption under it.

### Decision: A + C, plus one narrow deterministic check

**A is achievable here and B is not, so the fix is A, wired so that C follows
automatically.**

The decisive detail is that `ask.js` **already has the honest rendering path and
it is currently dead code**. `grounded()` computes
`uncited: !!e.answer && src.length === 0`, and there is already a warm banner —
*"Nothing was cited for this answer… treat it as the model's own words. Do not
repeat it to a customer without opening the source document yourself"* — plus a
"No sources cited" pill and an amber card edge. None of it can ever fire, because
the backend always sends a non-empty `sources`. The frontend was written for a
backend that told the truth; the backend does not. Making `sources` mean "cited"
switches all three on, **with no frontend change required at all**.

That is why A+C is the achievable option and not a compromise: the honest UI
already exists and is one backend field away.

Implementation, all inside the two Code nodes:

1. **`Build RAG Context`** labels blocks `[S1]`, `[S2]`, … and gives each source
   `ref`, `row_id` (`id`/`doc_id`/`document_id`/`chunk_id`, whichever the RPC
   projects, else `null` — stated, not faked), `included_in_prompt`, `truncated`,
   `chars_fed`, `chars_total`, and a 400-character excerpt of the text actually
   sent.

2. **Truncation is budgeted, not blind.** `substring(0, 8000)` is gone. The 8000
   characters are handed out by water-filling: at most
   `floor(8000 / (500 + 80)) = 13` blocks can each get a usable amount, short
   sections take only what they need and hand the surplus back, and long ones are
   cut only after every short one is satisfied. **When everything fits, nothing
   is truncated at all** — the common case at `match_limit: 6`, and one the old
   code never managed. Cuts land on a word boundary and are marked
   `truncated: true`; anything that did not fit is marked
   `included_in_prompt: false` with a note saying the answer cannot have come
   from it. Verified against four shapes: all-fit (0 truncated), one-huge-plus-
   three-small (only the huge one cut), 6 large rows, and 20 large rows (top 13
   kept at ≥500 usable chars, tail 7 excluded and labelled).

3. **The system prompt states the contract**: cite each sourced sentence with its
   `[S#]`; never state a number that is not in the context; reply
   `NOT_IN_CONTEXT` rather than answer from memory. `temperature` drops from
   `0.3` to `0` — there is no upside to sampling variance in a policy lookup.

4. **`Format Response` gates on the markers.** It parses `[S1]`, `[S 1]`,
   `[Source 1]`, `(Source 1)` — liberally on purpose, because punishing the
   model's formatting would manufacture a *false* "uncited", which is its own
   dishonesty. Then:
   * `sources` = **only** the blocks the model marked. Empty is a real value.
   * `retrieved_sources` = everything retrieval returned, under a **different
     key** so no renderer can mistake it for a citation.
   * `grounding.state` ∈ `cited` | `uncited` | `declined` | `no_documents` |
     `model_unavailable`, plus `cited_refs`, `invalid_refs`,
     `dropped_from_prompt`, `truncated_sources`, `sent_to_model`.
   * A marker the context does not contain (`[S9]` of 6 blocks) lands in
     `invalid_refs` and is **not** promoted to a citation.

5. **One narrow deterministic check, and it is labelled as narrow.** Every
   numeric token in the answer is diffed against every numeric token in the text
   the model was given; misses go to `grounding.unsupported_figures`. This is not
   claim verification and is not presented as one. It covers only numbers —
   because a refund window, an APR or a mileage cap is the part of a policy
   answer that does damage when invented, and it costs a regex on a shared vCPU.
   **Its stated limit:** a number present *anywhere* in the retrieved corpus
   passes, even if it came from an unrelated section. Verified in test: an
   invented "30-day refund window" passes when the HR handbook happens to say
   "30 days", while the invented "15 percent" is caught. It is an advisory flag
   for a human, never a gate, and never alters the answer.

Behaviour verified across eight scenarios: proper citation, answer-from-training-
knowledge, invented source number, loose marker format, `NOT_IN_CONTEXT`, both
tiers dead, empty `choices`, and zero retrieval.

`frontend.patch.md` describes optional improvements. **None of them are required
for the honesty fix** — the backend change alone flips `ask.js` onto its existing
honest path, and unknown keys like `retrieved_sources` are ignored by the current
build.

---

## 2 — `AI Answer - Backup Models` has no `onError`

`AI Agent - Generate Answer` fails over to `AI Answer - Backup Models` on its
error output. The backup has no `onError` at all, so when both tiers are down it
throws, the workflow stops, and `Respond to Webhook` never runs. The dashboard
request then hangs until `executionTimeout: 300` — and holds one of two
production slots the whole time. Two of them stall the WhatsApp bot and the lead
router for five minutes.

**Fail fast:**

`setNodeSettings` on `AI Answer - Backup Models` →
`onError: continueRegularOutput`, `alwaysOutputData: true`. The error arrives at
`Format Response` as data, which already handles it: `grounding.state` becomes
`model_unavailable` and the answer says plainly that nothing was answered from
the documents and that the matched sections have not been read by anything.
`Respond to Webhook` fires. The caller gets an answer instead of a hang.

**Answer honestly:**

`Delivery Report` used to record `SUCCESS` for a run whose answer text was
"the AI model call failed" — the HTTP response was delivered, so the delivery
check passed. It now reads `grounding.state` and downgrades
`model_unavailable` to `PARTIAL`, and appends notes for `uncited`, `declined`,
`dropped_from_prompt`, `unsupported_figures` and `invalid_refs`. `Audit Log` now
records retrieved-vs-cited counts and the grounding state. Same defect family:
do not record an outcome the run did not achieve.

**Bound the slot:**

Worst-case wall time was `10 + (15×3+3) + (60×2+1.5) + (60×3+3) = 373 s`,
truncated at 300 s by the execution timeout — and every second of it holding a
slot after the caller had already given up at 45 s.

Retries are cut because they were redundant: both nodes already pass a
three-model `models` array with `route: 'fallback'`, so OpenRouter itself retries
across six models before either node reports failure. Node-level retry on top of
that just multiplies the wait.

| Node | Before | After | Worst case |
|---|---|---|---|
| Verify JWT | 10 s, no retry | unchanged | 10 s |
| Supabase Knowledge Search | 15 s × 3 | 8 s × 2 | 16.8 s |
| AI Agent - Generate Answer | 60 s × 2 | 25 s × 1 | 25 s |
| AI Answer - Backup Models | 60 s × 3 | 20 s × 1 | 20 s |
| **to `Respond to Webhook`** | **~300 s (capped)** | | **~72 s** |

`executionTimeout` also drops 300 → 120 as a backstop, passed as the **complete**
settings object so nothing else in `settings` can be lost if the MCP replaces
rather than merges.

---

## 3 — Dead nodes that look alive

Both were checked the same way before proposing deletion: every string in the
export walked recursively (parameters, expressions, `systemMessage`, `notes`,
`jsCode`), plus the full `connections` graph in both directions across every
connection type, not just `main`. Evidence is embedded in
`OPERATIONS_deadnodes.json` next to each removal.

### (a) `Window Buffer Memory` — WhatsApp BDC AI Agent

`@n8n/n8n-nodes-langchain.memoryBufferWindow`, id `5`, position `[1024, 720]`.

* Not a key in `connections` — no outgoing edges.
* Not a target in any branch of any connection type.
* `AI BDC Sales Agent` has `ai_languageModel` from `OpenRouter Chat Model` and
  `Groq Chat Model`, and `ai_tool` from `search_inventory`, `search_policy` and
  `finance_calculator` — and **no `ai_memory` connection whatsoever**.
* History comes from `Fetch Thread History` (added 30 Aug 2026), read inside the
  agent's `text` expression via `$('Fetch Thread History').all()` in a try/catch.
* Its `sessionKey` expression references `Extract Message & Sender`, but a dead
  node's expression is never evaluated, so nothing depends on it.
* The only other occurrence of the string in the export is prose in the `notes`
  of `Fetch Thread History` — documentation, not a reference.

**Unreferenced. Confirmed.** It is a disconnected langchain sub-node, which is
what produces three validation warnings on every save. Those warnings are the
real cost: a save that always prints noise is a save nobody reads, so the next
genuine warning is ignored too.

### (b) `upsert_lead` — NEXUS Master Lead Router - AI Agent

`n8n-nodes-base.httpRequestTool`, id `1598f41b-…`, position `[880, 560]`,
carrying `supabaseApi` credential `dv4OeARarErZLHCj`.

* Not a key in `connections`, not a target in any branch of any type — **no
  `ai_tool` edge to `AI Lead Scoring Agent`**, so the agent cannot call it.
* The agent's real tools are `Supabase Lead Lookup` and `check_purchase_history`.
* The string `upsert_lead` occurs **exactly once** in the entire export, at
  `/nodes/7/name`. It is in no expression and in no `systemMessage`, so nothing
  even tells the model such a tool exists.
* Fully superseded by `Persist Lead (deterministic)` at `[880, 32]`: same table
  `rest/v1/leads`, same `on_conflict=email`, same
  `Prefer: resolution=merge-duplicates,return=minimal`, same credential — but
  bound from `Parse AI Decision`'s item rather than `$fromAI`. That node's own
  note records why it exists: *"on exec 6253 it simply did not [call the tool],
  and the run still audited SUCCESS."*

**Unreferenced. Confirmed.** Deleting it removes an unreachable Supabase write
path that still carries a live write credential — one reconnected wire away from
letting a model write rows again — and removes nothing the router does.

---

## 4 — `NEXUS Infra Health Probe` reports health it has not verified

It probes one thing, `http://waha:3000/api/sessions/default`. With
`neverError: true` **and** `onError: continueRegularOutput`, a dead WAHA
container yields `status: null` inside an HTTP **200**. There is no pass/fail
node anywhere, and the workflow is webhook-only, so nothing calls it and nothing
alerts.

The change is **additive and tail-side by construction**: `Probe Webhook`,
`WAHA Sessions`, `Format Probe` and `Run Manually` are left untouched in identity
and parameters. Only `Format Probe`'s outgoing edge is rewired. See RISKS.md for
the merge order with the other agent's authentication work.

### Shape

```
Probe Webhook ─┐
Run Manually  ─┼─→ WAHA Sessions → Format Probe → Check Supabase Auth
Schedule/15m  ─┘                                        ↓
                                                 Check Supabase REST
                                                        ↓
                                                  Check OpenRouter
                                                        ↓
                                                  Health Verdict
                                                        ↓
                                                 All Checks Pass?
                                              true ↙            ↘ false
                                          Respond (200)   Respond Unhealthy (503)
                                                                  ↓
                                                            Fail The Run
```

A **linear chain, not a fan-out**, on purpose. A fan-in to `Health Verdict` would
run it once per arriving branch and emit several responses; and on one shared
vCPU, sequential checks are cheaper than parallel ones anyway. It also removes
any dependence on `executionOrder: v1`'s canvas-y-position ordering. Every check
carries `onError: continueRegularOutput` + `alwaysOutputData`, so one dead
dependency cannot stop the chain, and `Health Verdict` reads each with
`$('Node Name')` inside try/catch.

### The rule the verdict is built on

> **A check that could not determine an answer reports `unknown`.
> `unknown` is never counted as `up`.**

Three states per check roll up to three verdicts:

| verdict | meaning | HTTP | run |
|---|---|---|---|
| `ok` | every check positively passed | 200 | succeeds |
| `degraded` | nothing failed, something is unverifiable | 200 | succeeds |
| `down` | at least one check positively failed | **503** | **fails** |

`degraded` is deliberately not a 503: it means *"we could not tell"*, and paging
someone because an env var is missing is a different message from paging them
because WAHA is dead. **An uptime monitor must alert on `verdict != "ok"`, not on
the HTTP status alone.** That is stated in the node's own comment and in the
response body.

### The checks

| check | how | `down` | `unknown` |
|---|---|---|---|
| `waha_session` | existing `Format Probe` output, now judged | no response, non-200, or session state ≠ `WORKING` (`SCAN_QR_CODE`, `STARTING`, `STOPPED`, `FAILED` all mean no messages move) | — |
| `supabase_auth` | `GET /auth/v1/health`, unauthenticated | no response, or ≥500 | any other non-200 |
| `supabase_rest` | `GET /rest/v1/rag_documents?select=id&limit=1`, key from `$env` | no response, or ≥500 | 401/403 — *"PostgREST answered so it is running, but the key is not in `$env`, so this probe CANNOT confirm the database is readable"* |
| `openrouter` | `GET /api/v1/key`, key from `$env` | no response, or ≥500 | 401/403 (no key), 429 (rate limited — *"may or may not still serve models; this probe cannot tell"*) |

Secrets are read as `$env.SUPABASE_ANON_KEY` / `$env.OPENROUTER_API_KEY`, matching
the existing `$env.WAHA_API_KEY` pattern — **no `credentials` block is attached to
any new node**, because no Supabase or OpenRouter credential exists in this
export to confirm an id and type from. A missing env var degrades to `unknown`,
never to a false pass.

`/api/v1/key` was chosen over `/api/v1/models` deliberately: a few hundred bytes
with usage and rate-limit state, against roughly a megabyte to parse every 15
minutes on 958 MB of RAM.

### What it refuses to claim

Disk and host memory are the two things most often asked of a health probe and
the two this workflow cannot honestly answer: an n8n Code node has no shell and
no filesystem. `process.memoryUsage()` is read *if the sandbox allows it*, and
reported with its scope spelled out — **the n8n/task-runner process, not the
958 MB VM** — flagged `counts_towards_verdict: false`, and excluded from the
verdict, because there is no defensible threshold to compare it against from in
here. If the sandbox denies it, the response says host memory is not measured.
Nothing is invented either way.

Every response also carries `not_checked[]`, enumerating the probe's own blind
spots — host disk and memory, Postgres itself (only PostgREST and GoTrue were
probed), n8n queue depth and slot saturation, real end-to-end delivery, and the
Bitrix24/Groq/Gmail credentials — so that a green response can never be read as
"everything on this box is fine".

### Schedule and alert

`Schedule - Every 15 Minutes` feeds `WAHA Sessions` directly, so the probe
finally runs on its own. On a hard failure, `Respond Unhealthy` sends the 503
**first**, then `Fail The Run` (`stopAndError`) fails the execution — which is
what hands it to the instance error workflow already configured in
`settings.errorWorkflow` (`iYJkh1kztWxZXDbT`). That is the only alert channel
confirmed present in this export: there is no Slack or Supabase credential in
this workflow to post to directly, and inventing one would mean attaching a
credential id copied from a different export.

Cost: four HTTP calls, worst case ≈ 40 s, holding one of two slots for ~4 % duty
cycle. `saveDataSuccessExecution: none` is already set, so successful runs add no
execution rows; failed ones are saved.

Verdict logic verified across eight states: all healthy, WAHA dead, WAHA
`SCAN_QR_CODE`, no env keys set, Supabase 5xx, OpenRouter 502, a check node that
errored outright, and `Format Probe` missing from the branch entirely.
