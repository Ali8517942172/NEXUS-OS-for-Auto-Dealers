# Safety-net repair — Phase 6 Silence Detector + Lead Escalation

Offline design. Two workflows, applied as `update_workflow` operation arrays:

| File | Workflow | ID |
|---|---|---|
| `OPERATIONS_phase6.json` | Phase 6 - 12-Hour Silence Detector (10 nodes) | `B3TcpfzOMWj8oWgF` |
| `OPERATIONS_escalation.json` | Lead Escalation - AI Agent (23 nodes) | `KI6P1Qcf3MIZakNa` |

Both keep `executionOrder: v1`. Where a node fans out, order is decided by canvas
y-position (lower y runs first), so every position change below is load-bearing,
not cosmetic. Credential id is the placeholder `"<<SUPABASE_CRED_ID>>"` (live value
today: `dv4OeARarErZLHCj`, "Supabase account").

---

## Defect 1 — WhatsApp-only leads are permanently exempt from silence detection

**What is wrong.** `Find Silent Leads` indexes `communication_logs` by
`lead_email` and looks the lead up with a single exact key,
`byLead[String(lead.email)]`, then `if (!rows.length) continue`.

`communication_logs.lead_email` is not an email column. It holds whatever the
workflow that wrote the row had at hand:

* `7_day_warm_lead_drip_campaign` writes the real email.
* `whatsapp_bdc_ai_agent` → *Log Conversation* / *Log Incoming Message* write
  `lead_email || sender`, i.e. the raw **chat id** — `971501234567@c.us`, or
  `158510264357112@lid` — whenever identity resolution did not match a lead.
* `whatsapp_send_dashboard_reply` → *Log Outbound* writes `chat_id`, always.
* The lead row for a WhatsApp customer carries the synthetic email
  `+<digits>@whatsapp.lead`.

So for a WhatsApp-only lead the two sides never share a string, `rows.length`
is 0, the lead is skipped, and the hourly job finishes green with zero output.
This is not an edge case in a Dubai used-car dealership — it is most of the book.

**The fix.** Same shape as the reference implementation, *Fetch Thread History*
in `whatsapp_bdc_ai_agent.json`, which resolves identity by querying
`or=(lead_email.eq.<sender>,lead_email.eq.<lead_email>,lead_email.eq.+<digits>@whatsapp.lead)`.
That node goes chat → lead; we need lead → chat, so the same key set is built in
the opposite direction inside `Find Silent Leads`:

1. Every log row is indexed twice — under its exact lower-cased `lead_email`,
   and under the **last 9 digits** of the number embedded in it (the same
   country-code-safe comparison `Resolve Lead Identity` uses, so `+9715…`,
   `009715…` and `05…` collapse to one key).
2. Every lead produces a key set: its email, `+<digits>@whatsapp.lead`,
   `<digits>@whatsapp.lead`, `<digits>@c.us`, `<digits>@s.whatsapp.net`, the
   bare digits, `+<digits>` — digits taken from `leads.phone`, falling back to
   the local part of a `…@whatsapp.lead` email.
3. Rows are collected across *all* those keys and de-duplicated on `id`.

**`@lid` needs a bridge.** A LID chat id (`158510264357112@lid`) contains no
phone digits at all — the WhatsApp workflow says so in its own comment, and
pulls the real number out of `_data.Info.SenderAlt`. Digits from a LID are an
opaque WhatsApp id and would collide with real numbers, so LID keys are
deliberately excluded from the digit index. Instead a new node
**`Fetch WhatsApp Contacts`** reads `whatsapp_contacts` (the `chat_id → phone /
lead_email` map that *Upsert WhatsApp Contact* already maintains) and every
`chat_id` whose phone-tail or `lead_email` matches the lead is added to that
lead's key set. It is `executeOnce`, `onError: continueRegularOutput` — if the
table is unreachable the detector degrades to non-LID matching rather than
failing.

New chain: `Fetch Open Leads → Fetch Recent Comms → Fetch WhatsApp Contacts → Find Silent Leads`.

---

## Defect 2 — every silence escalation lands in the wrong Slack channel

**What is wrong.** `Trigger Lead Escalation` maps `defineBelow {email, name,
reason}`. The callee's trigger `Called by Master Router` is
`inputSource: "passthrough"`, which ignores the caller's field mapping entirely
and forwards the caller's input item verbatim — and the loop item built by
`Find Silent Leads` has no `reason` key. The Slack node routes on exactly that:

```
channelId : (j && j.reason) ? 'C0BKTLL1X54' : 'C0BJ5PLTPDJ'
text      : (j && j.reason) ? ':rotating_light: *Escalated Lead Alert*' : ':fire: *Hot Lead*'
        where j = $('Called by Master Router').first().json
```

Result: every 12-hour-silence escalation is posted to the **hot-lead** channel
under **":fire: Hot Lead"**. The rep reads it as a fresh inbound, not as a
customer they have already lost 12 hours with.

### Which side to fix — the caller. Reasoning.

Changing the callee to `inputSource: "workflowInputs"` and declaring
`{email, name, reason}` would fix this workflow and break the other one.
`ExecuteWorkflowTrigger` hard-filters with `pickBy(json, key => declaredKeys.has(key))`:
**every undeclared key is dropped**. The Master Router calls the same workflow
from *Slack Router (HOT)* with an empty `defineBelow` mapping — a passthrough
call — and its item is `{ lead: {...}, ai_decision: {...} }`. Under a declared
schema of `{email, name, reason}` that item arrives as `{}`, and
`Fetch Escalated Lead` (`$json.lead?.email || $json.body?.email || $json.email`)
then looks up `undefined`, finds nothing, and every hot lead the router escalates
stops reaching a human. The webhook path and the manual `Test Lead` path would
be filtered the same way.

The routing logic is also *already correct*: the Master Router's item has no
top-level `reason` (its reason is nested inside `ai_decision`), so hot leads
correctly stay on the hot-lead channel. Only the silence caller failed to supply
the discriminator. **So the caller supplies it, and the callee's trigger is not
touched.**

**The fix, caller side.** `Find Silent Leads` now emits `reason` (and
`escalation_reason`, and `escalation_source: 'phase6_silence_detector'`) on the
item itself — the item the passthrough trigger forwards verbatim. No extra node,
so nothing changes about paired-item lineage for the downstream
`$('Loop Over Silent Leads').item` references. The now-dead `defineBelow`
mapping on `Trigger Lead Escalation` is replaced with the empty mapping the
Master Router uses, so the next reader is not misled into thinking it does
anything.

**The fix, callee side (one expression).** The AI prompt's
`"if the escalation reason mentions the customer has gone silent for N hours"`
branch was unreachable for a second, independent reason: the agent resolves the
reason as `$('Fetch Escalated Lead').first().json.escalation_reason || $json.reason`,
but `$json` at the agent is the `Model Ladder` output, which spreads the item
coming out of `Found The Lead?` — the **leads DB row**, not the trigger item. The
reason never existed there under any caller. The prompt now resolves it from the
trigger, each lookup wrapped in try/catch so it is safe on all four entry paths:
`Called by Master Router` → `EscalationWebhook` (`.body`) → `Test Lead` →
`leads.escalation_reason` → `'not specified'`.

---

## Defect 3 — the 12-hour marker never expires

**What is wrong.** Two bugs in one line plus one in the writer:

```js
if (rows.some(r => r.message.startsWith('[SILENCE-ESCALATED]'))) continue;
```

* It is checked against **all** history, not the current silence episode. One
  escalation retires a lead from the safety net permanently — escalated in
  March, goes quiet again in August, never surfaced again.
* `Mark as Escalated` writes the marker with `direction: 'outbound'`, so the
  marker itself becomes the newest outbound row: `lastOut` jumps to the moment
  of escalation and `hours_silent` resets to 0.

**The fix.**

* Marker rows are filtered out of both the `outbound` and `inbound` sets before
  `lastOut` / `lastIn` are computed, so our own bookkeeping can never masquerade
  as a message to the customer. (This also repairs leads already carrying
  historic `direction:'outbound'` markers.)
* The suppression is scoped to the episode: `if (lastMarker >= lastOut) continue`.
  A marker written **before** our last real outbound belongs to a closed episode
   — we have spoken to them since — and no longer suppresses.
* `Mark as Escalated` now writes `direction: 'internal'` (`channel` was already
  `'system'`). `communication_logs.direction` is plain `text` with no CHECK
  constraint, and `'internal'` is invisible to every consumer that filters on
  `'inbound'` / `'outbound'`.

---

## Also fixed, same cluster

### `Fetch Open Leads` — a filter that excluded nothing
Two `neq` conditions with no `matchType`; n8n defaults to `anyFilter` (OR), and
`status ≠ LOST OR status ≠ DISQUALIFIED` is true for every row. Fixed with
`matchType: "allFilters"`, plus a third condition excluding **WON** — without it
a delivered customer who stops replying is escalated to a senior rep as a
stalled deal. `.filter(l => l && l.email)` is replaced by
`.filter(l => l.email || l.phone)`, so phone-only leads (exactly the population
Defect 1 is about) stay in. The terminal-status check is re-asserted in the code
node on `String(status).toUpperCase()`, because PostgREST `neq` is
case-sensitive and would let a lower-case `lost` through.

### `Fetch Recent Comms` — the whole table, every hour
`returnAll: true` with no filter on a 958 MB box. Now filtered to
`created_at >= $now.minus({days: 40})` with `matchType: allFilters`, ordered
`created_at.desc` as before, `executeOnce` retained. The code node's
`MAX_SILENCE_HOURS = 24 * 40` matches that window, so a lead whose last contact
predates it is skipped explicitly rather than by accident.

### `waitForSubWorkflow: true` inside a `splitInBatches` loop
Kept — deliberately — and the harm bounded instead. The correctness of both the
`Delivery Report` and the permanent marker depends on reading the callee's
`Return Result`; making the call fire-and-forget would leave the marker
ungated and re-open Defect 4 permanently, which is the worse failure. What made
it dangerous was that the loop was *unbounded*: the first run after the Defect-1
fix will surface every WhatsApp lead in the book at once, and this workflow's
`executionTimeout` is 300 s — the run would be killed mid-loop, leaving leads
escalated but unmarked (and re-escalated next hour). `Find Silent Leads` now
sorts by `ai_score` and returns at most **`MAX_PER_RUN = 8`** leads; the rest are
picked up on the next hourly run. A bounded run also all but removes the overlap
window that produced the concurrent-run double-escalation.

### `Delivery Report` passed failed escalations
It only asked `j.error !== undefined`. The sub-workflow does not throw on
failure — it *returns*
`{status:'escalation_failed', escalated:false, delivery:{status:'FAILED'}}`
with no top-level `error`. So a failed escalation passed, `Mark as Escalated`
wrote the permanent marker anyway, and (with Defect 3) the lead was retired
having been escalated to nobody. Two changes:

1. The escalation claim is judged on the payload: error item **or**
   `escalated !== true` ⇒ FAILED, with the callee's own `status` / `delivery.note`
   / `delivery.dropped` quoted into the audit row.
2. A new IF node **`Escalation Landed?`** (`{{ $json.escalated === true }}`) sits
   between `Trigger Lead Escalation` and `Mark as Escalated`. Only the true
   branch writes the marker. The false branch still reaches `Delivery Report`
   (so the failure is audited) and still returns to the loop, and the lead stays
   in the safety net for the next run.

The marker claim on the false branch is reported as *deliberately skipped*
rather than probed — `$('Mark as Escalated').all()` inside a loop returns the
**previous iteration's** run data, which would have produced a false "verified".

### Layout, because v1 fan-out order is positional
`Mark as Escalated` fans out to `Loop Over Silent Leads` **and** `Delivery Report`.
Under `executionOrder: v1` the lower-y target runs first, so with the loop at
y=304 the loop-back would start the next iteration before this iteration's
report and audit row were written, and `$('…').item` lookups would resolve
against the wrong lead. `Delivery Report` moves to `[1600, 160]` and `Audit Log`
to `[1840, 160]` — both above the loop — so the report/audit branch always
completes first. `Mark as Escalated` moves to `[1600, 400]` to make room for
`Escalation Landed?` at `[1400, 400]`.

Same reasoning in the callee: `Return Result` has two incoming edges (from
`Send a message` and from `Delivery Report`). At `[1312, 304]` it outranks
`Delivery Report` `[1456, 432]` on y, so the Slack-branch run of `Return Result`
could execute *before* `Delivery Report` and answer the caller
`status:'escalation_unverified', escalated:false` for an escalation that fully
landed — which, with the new gate, would suppress a correct marker and
re-escalate the lead every hour. Moving `Return Result` to `[1660, 720]` (below
every other node) makes it the last node to run, so the run the caller reads
always sees `Delivery Report`. `Send a message` also gets
`onError: continueRegularOutput` + `alwaysOutputData`, so a Slack outage can no
longer abort an escalation whose email already landed.
