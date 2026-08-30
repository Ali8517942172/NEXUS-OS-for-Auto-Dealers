# RISKS — cleanup batch

## 0. Ordering constraints

### 0a. The probe and the other agent's authentication change — MUST MERGE FIRST

Another agent is changing `NEXUS Infra Health Probe` (`57QpbNQGwlFKb0q3`) for an
authentication concern. **`OPERATIONS_probe.json` and that change must be merged
into a single `update_workflow` call, or applied in the stated order below.
`update_workflow` replaces the node and connection graph; two independent
operation sets applied blind will not compose, and the second one applied will
silently drop the first.**

This change was written to be tail-side to make that merge cheap:

**Untouched by this change** — `Probe Webhook`, `WAHA Sessions`, `Run Manually`,
and every parameter of `Format Probe`. `Probe Webhook`'s outgoing connection is
**not** modified, which is where an auth gate has to be inserted.

**Touched by this change** — one connection removed (`Format Probe` → `Respond`),
seven nodes added, `Respond` repositioned and its parameters replaced.

**If applied in sequence, apply the authentication change FIRST, then this one.**
The auth change inserts nodes at the head of the graph; this one extends the
tail. Re-export the workflow between the two and re-check the two collision
points below.

Two things to check at merge, both real:

1. **`Schedule - Every 15 Minutes` connects directly to `WAHA Sessions`, and
   deliberately bypasses any request-auth gate.** This is correct and must not be
   "fixed": a scheduled item carries no `Authorization` header, so routing it
   through a JWT gate would send every scheduled run down the reject branch and
   the probe would never actually probe anything. If the other agent's gate sits
   between `Probe Webhook` and `WAHA Sessions`, leave the schedule edge where it
   is. If their gate is instead placed on `WAHA Sessions` itself, the schedule
   edge must be re-pointed to the first node *after* their gate.
2. **If the auth change adds its own `Respond 401` node, it must not also claim
   `Format Probe`'s outgoing edge.** There is now exactly one edge out of
   `Format Probe`, to `Check Supabase Auth`.

Also: an authenticated probe endpoint cannot be polled by a plain uptime monitor.
If the other agent gates the webhook, the schedule + `Fail The Run` + error
workflow path becomes the *only* alerting route. That is a design consequence of
their change, not a defect in this one, but somebody should decide it on purpose.

### 0b. Ask-AI ops vs. the `ask.js` change

`OPERATIONS_askai.json` is safe to apply **before, after or without**
`frontend.patch.md`. The current `ask.js` ignores unknown keys and already
renders the honest path for an empty `sources`. There is no ordering constraint.

### 0c. The two dead-node removals

Independent of everything else and of each other. Two separate
`update_workflow` calls, one per `workflowId` in `OPERATIONS_deadnodes.json`.

---

## 1. Ask-AI (defects 1 and 2)

### What could break

* **Every answer could come back "No sources cited".** This is the main risk and
  it is a behavioural risk, not a bug. If the free-tier ladder
  (`nemotron-3-ultra`, `gemma-4-31b`, `nemotron-3-super`, then `minimax-m2.7`,
  `gemma-4-26b`, `minimax-m3`) ignores the `[S#]` instruction, no answer will
  show a source panel again. **That is the honest state of affairs and is still a
  strict improvement** — it stops the system asserting a grounding it never
  established — but the team will experience it as a regression on day one. Watch
  it, and do not "fix" it by reverting to retrieved-as-cited.
  Mitigation if the rate is bad: the parser is already liberal (`[S1]`, `[S 1]`,
  `[Source 1]`, `(Source 1)`); the next lever is a one-shot example in the system
  prompt, then reordering the model ladder toward whichever tier marks reliably.
  Do **not** add a heuristic that infers citations from text overlap — that is
  option (B) from DESIGN.md wearing a disguise.
* **`temperature` 0.3 → 0** changes answer wording. Nothing depends on the
  wording, but anyone comparing before/after outputs will see drift.
* **Shorter per-answer context.** With ≤13 blocks the practical effect at
  `match_limit: 6` is nil, and when everything fits nothing is truncated at all
  (an improvement on `substring(0, 8000)`). But a question that legitimately
  needs one very long section now gets that section water-filled against five
  others rather than taking the whole budget. If answers get thinner, lower
  `match_limit` in `Extract Question`'s downstream RPC call from 6 to 4 rather
  than raising `TOTAL_BUDGET` — the box has 958 MB.
* **Reduced retries.** `retryOnFail` is off on both model nodes. If OpenRouter's
  internal `route: 'fallback'` turns out not to cover a class of transient error,
  failures will now surface immediately as `model_unavailable` rather than being
  papered over by a second attempt. Watch the `PARTIAL` rate in `audit_log`
  before deciding; it is one `setNodeSettings` op to put back.
* **`executionTimeout` 300 → 120.** A legitimately slow run that would have
  finished at 150 s is now killed. The budget table in DESIGN.md puts worst case
  at ~72 s, so this should not bite — but it is the change most likely to produce
  a surprise, and the caller has already given up at 45 s regardless.
* **`setWorkflowSettings` semantics.** Unknown whether the MCP merges or replaces
  the settings object, so the **complete** settings block from the export is
  passed with only `executionTimeout` changed. Lossless either way. Verify after
  applying that `errorWorkflow`, `callerPolicy`, `timezone`, `binaryMode` and
  `availableInMCP` all survive.

### What could not be verified offline

* **Whether `search_rag_documents` projects an id column.** `row_id` reads
  `id` / `doc_id` / `document_id` / `chunk_id` and falls back to `null`. If the
  RPC returns none of them, `row_id` is `null` everywhere and traceability falls
  back to title + section + page. The code states this rather than inventing an
  id. **Check the first real response** and, if there is no id, add one to the
  RPC's return type — that is the actual fix for "nobody can pull the exact text".
* **Whether free-tier models honour `[S#]` at all.** Untestable without live
  calls. See the first bullet above.
* **The exact error shape** an n8n `httpRequest` node emits on
  `onError: continueRegularOutput`. `Format Response` branches on
  `aiResponse.error !== undefined` and handles both a string and an object; if
  a build wraps it differently, the run falls to the `empty choices` branch,
  which also yields `model_unavailable` and still responds. Either way the
  caller gets an answer — that is the property that matters.
* **Whether the MCP accepts a nested `options` object via
  `updateNodeParameters` with `replace: false`.** `options` is passed as a whole
  containing object (never a deep pointer such as `/options/timeout`), which is
  the documented-safe form. The original `options` on each node contained only
  `timeout`, so replacing the whole object is lossless.

### After applying

1. Ask a question with a known answer in the knowledge base. Confirm the panel
   lists **only** the sections the answer marked, and that `grounding.state` is
   `cited`.
2. Ask something not in the knowledge base. Expect `no_documents` or `declined`,
   an empty `sources`, and the existing warm banner.
3. Force a model outage (revoke the OpenRouter key, or point both nodes at a
   nonexistent model id) and confirm: an HTTP response arrives in well under
   45 s, `grounding.state` is `model_unavailable`, and `audit_log` records
   **`PARTIAL`, not `SUCCESS`**. This is the specific regression that made
   defect 2 invisible.
4. Fire two of those concurrently and confirm the WhatsApp bot and lead router
   still respond — that is the actual damage being fixed.
5. Check `audit_log` summaries now carry `retrieved: N | cited: M | grounding: …`.
6. Confirm no answer renders a source panel with `documents_cited: 0`.

---

## 2. Dead nodes

### What could break

* **Almost nothing.** Neither node is reachable. The removals are `removeNode`
  only — no connection ops, because neither node has any connection to remove.
* **Cosmetic leftover:** `Fetch Thread History`'s `notes` still reads *"Durable
  replacement for Window Buffer Memory, which was in-process only."* That is now
  a reference to a node that does not exist. It is prose in a `notes` field, it
  affects nothing, and it is genuinely useful history. It is left alone on
  purpose: the observed MCP operation vocabulary
  (`addNode`/`removeNode`/`setNodeParameter`/`updateNodeParameters`/
  `setNodeSettings`/`setNodePosition`/`addConnection`/`removeConnection`/
  `setWorkflowSettings`) has no confirmed way to edit `notes` on an existing
  node, and guessing that `setNodeSettings` accepts it risks a rejected or
  mis-applied operation for a comment. Fix it by hand in the editor if it bothers
  anyone.
* **Losing a spare part.** `upsert_lead` is the only remaining example in the
  repo of a `$fromAI`-driven `httpRequestTool` against `leads`. If someone wants
  it later they will have to write it again. That is the point — it currently
  sits in production carrying a live Supabase write credential, reachable the
  moment anyone drags one wire onto it.

### What could not be verified offline

* **Whether the live workflows still match these exports.** Both are dated
  30 Aug 2026 (BDC 04:10 UTC, router 02:12 UTC) — the same day as this work. If
  anything has been edited since, re-run the reference check before deleting:
  the node must be absent as a `connections` key, absent as a target across
  **all** connection types (not just `main`), and absent from every string in the
  export.
* **Whether n8n rejects removing a node another node's UI state references.** No
  such reference exists in either export.

### After applying

1. Save each workflow and confirm the validation warning count drops by three on
   `WhatsApp BDC AI Agent`. That drop is the whole point: a save that always
   prints noise trains everyone to skip the output.
2. Send one WhatsApp message and confirm the BDC agent still recalls earlier turns
   — that proves `Fetch Thread History`, not the deleted memory node, was
   supplying context all along.
3. Post one lead to the master router and confirm a row still lands in `leads`
   via `Persist Lead (deterministic)`.
4. Confirm no agent node now shows a red "missing connection" marker.

---

## 3. Infra probe

### What could break

* **New alert noise.** A hard failure now fails the execution every 15 minutes
  while it persists — up to 4 error-workflow invocations per hour, indefinitely,
  with no deduplication. A WAHA session sitting in `SCAN_QR_CODE` over a weekend
  will produce roughly 200 alerts. If that is unacceptable, widen the schedule to
  30 or 60 minutes, or add suppression in the error workflow. It was left noisy
  on purpose: the previous state was zero alerts, and under-alerting is what
  produced this defect.
* **`SCAN_QR_CODE` counts as `down`.** Correct — no messages move — but it will
  fire during any legitimate re-pairing, including a deliberate one.
* **New load.** Four sequential HTTP calls, worst case ~40 s, holding one of two
  production slots. Duty cycle ~4 %, but it is not zero, and it now coincides
  with lead traffic. If slot contention appears, move the schedule to 30 minutes
  first.
* **The `Respond` node's parameters are replaced** (`replace: true`) — from
  `respondWith: allIncomingItems` to `respondWith: json` with an explicit 200.
  Any consumer parsing the old array-of-items shape will break. The response
  body is now a single object with `verdict` / `ok` / `checks` / `not_checked`.
  Nothing in the audited tree calls `/infra-probe`, but an external monitor might.
* **503 responses.** An external monitor previously configured against a
  permanent 200 will start reporting outages. That is the fix working.
* **`stopAndError` after `respondToWebhook`.** The 503 is sent first, then the
  run fails. If a build orders these differently the caller gets a generic 500
  rather than the verdict body. Either way the alert fires and the failure is
  visible; only the body is at risk.

### What could not be verified offline

* **That `https://dsvuoovivysszdoiorch.supabase.co/auth/v1/health` returns 200.**
  It is the documented unauthenticated GoTrue health endpoint, but it was not
  called. If it 404s, the check reports `unknown` — never a false pass — and the
  probe sits at `degraded`. **Fallback if so:** point it at
  `https://dsvuoovivysszdoiorch.supabase.co/rest/v1/` and treat 200 **or** 401 as
  reachable, since both prove PostgREST is answering.
* **That `https://openrouter.ai/api/v1/key` exists and accepts a bearer token.**
  Same failure mode: an unexpected status reports `unknown`. **Fallback:**
  `https://openrouter.ai/api/v1/models`, which is public and needs no key — at
  the cost of parsing roughly a megabyte every 15 minutes on a 958 MB box.
* **The env var names `SUPABASE_ANON_KEY` and `OPENROUTER_API_KEY`.** These are
  guesses. Only `WAHA_API_KEY` is confirmed from the export. **If they are wrong
  or unset the checks report `unknown`, the verdict is `degraded`, and nothing is
  falsely claimed** — the design absorbs this by construction. But until the real
  names are set on the n8n container, `supabase_rest` and `openrouter` verify
  nothing. **This is the single highest-value follow-up**: confirm the names with
  `docker exec <n8n> env | grep -iE 'supabase|openrouter'` and correct the two
  header expressions. No credential block is attached to any new node, so this is
  a one-line edit per node.
* **Whether `process.memoryUsage()` is reachable in this instance's Code
  sandbox.** Wrapped in try/catch; if denied, `runtime.measured` is `false` and
  the response says host memory is not measured. It never contributes to the
  verdict either way.
* **`n8n-nodes-base.stopAndError` typeVersion 1 and its `errorMessage`
  parameter.** Not confirmed against a live node type. If the node is rejected on
  import, drop that one `addNode` and its one `addConnection` — the 503 and the
  verdict body still work; only the error-workflow alert is lost.
* **`scheduleTrigger` typeVersion 1.2 and the
  `rule.interval[{field:'minutes',minutesInterval:15}]` shape.** If rejected,
  create the trigger in the editor instead; nothing else depends on it.

### Deliberate non-goals — what this probe still does NOT check

Stated here so nobody reads a green endpoint as a clean bill of health. These are
also published in `not_checked[]` on every response:

* Host disk usage and host memory on the e2-micro. An n8n Code node has no shell.
  **The right home for this is a host-level cron** (`df -P /`, `free -m`) POSTing
  into a second webhook path on this workflow, or a container-level agent — not a
  fabricated in-workflow "check".
* Postgres itself. A healthy PostgREST does not prove query latency or
  connection-pool headroom.
* n8n queue depth and whether both production slots are saturated — which is
  precisely the condition defect 2 creates.
* End-to-end delivery: that a WhatsApp message reaches a customer, or that a
  model returns tokens.
* Bitrix24, Groq and Gmail credentials.

### After applying

1. `GET /webhook/infra-probe` with everything healthy → HTTP 200,
   `verdict: "ok"`, four checks in `checks`.
2. Stop the WAHA container → HTTP **503**, `verdict: "down"`,
   `failed[0]` naming the WhatsApp gateway, and a failed execution in n8n that
   reached error workflow `iYJkh1kztWxZXDbT`. **Confirm the alert actually
   arrived** — an alert path that is not observed to fire is the same defect
   class as this whole batch.
3. Unset (or mis-set) `SUPABASE_ANON_KEY` → `verdict: "degraded"`, HTTP 200,
   `supabase_rest.state: "unknown"`. Confirm it is **not** reported as `up`.
4. Wait 15 minutes with no request and confirm a scheduled execution ran.
5. Confirm `not_checked[]` is present on every response, healthy runs included.
6. Confirm the healthy path holds one slot for under ~40 s, and that lead
   traffic during a probe run is unaffected.
7. Tell whoever owns the uptime monitor: **alert on `verdict != "ok"`, not on the
   HTTP status alone.** `degraded` returns 200 by design and means "could not
   verify", which is exactly the state this batch exists to stop hiding.
