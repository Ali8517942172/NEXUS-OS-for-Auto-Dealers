# 7-Day Warm Lead Drip — exit conditions, phone lookup, honest roster

Target workflow: **`G7FhvMY2ucW5Fg7X` — "7-Day Warm Lead Drip Campaign"**
Read from: `/home/claude/audit/n8n-workflows/7_day_warm_lead_drip_campaign.json` (22 nodes, `executionOrder: v1`).
Apply with: `mcp__n8n__update_workflow` and the array in `OPERATIONS.json` (76 operations, one call, under the 100-op cap).

---

## 1. What is wrong today

Between `Normalize Lead Input` and the four sends there is not one node that re-reads `leads`,
checks `communication_logs`, or tests lead status. The chain is:

```
Normalize Lead Input → Wait Day 1 → Email: Welcome → Log → Has WhatsApp?(D1) → [WA] → Wait Day 3
  → Email: Follow Up → Log → Wait Day 5 → Has WhatsApp?(D5) → [WA] → Wait Day 7
  → Email: Final Offer → Log → Delivery Report → Audit Log
```

Every arrow is unconditional. A COLD lead who replies on day 2, is upsold and buys on day 2 still
gets "Still looking at the Land Cruiser?", "Want me to book you a test drive?", and an "exclusive
5% discount, valid 48 hours" — after paying full price.

Two more confirmed defects sit in the same chain:

* **The phone never arrives.** The dashboard posts `{lead_email, lead_name, vehicle_interest}`
  (`apps/executive-dashboard/screens/leads.js:181`, `screens/campaigns.js:1180`). `Normalize Lead
  Input` reads `phone || whatsapp`, so `phone` is `null`, and both `Has WhatsApp?` gates test
  `!!$('Normalize Lead Input').first().json.phone` — every dashboard enrolment silently skips the
  Day-1 WhatsApp welcome and the Day-5 check-in.
* **The audit row is written at the wrong time.** The single `Audit Log` node is downstream of all
  four Waits, so it records completion, not enrolment. `screens/campaigns.js:348-358` builds the
  "who is enrolled" roster from the *oldest* `audit_log` row per `lead_email` — so a live enrolment
  shows nobody for seven days, then appears as enrolled once the sequence has already finished.

**A third defect, found while reading, is fixed here because the roster requirement cannot be met
without it.** `Log Final Offer Email` sends `Prefer: return=minimal`, so the item reaching
`Delivery Report` has no lead fields; `Delivery Report` spreads that empty item, and `Audit Log`'s
`lead_email: ($json.lead_email || $json.email || null)` therefore writes **`null` on every completed
run**. Those rows land in the dashboard's `unkeyedIdx` bucket — "drip runs have no lead_email on the
audit row and cannot be attached to anybody" (`campaigns.js:1236`). Adding an enrolment row without
fixing this would give a roster keyed on the enrolment row alone, with completions still floating
free. `Delivery Report` now names the lead explicitly.

---

## 2. The exit logic, in plain terms

Immediately before each of the four sends — not once at enrolment — the workflow asks the database
two questions and stops the sequence if either answer is bad:

1. **Is this still a live lead?** Re-read the `leads` row by email.
   *Stop* if the row is gone, or if its status is terminal:
   `WON, LOST, CLOSED, CONVERTED, DELIVERED, DEAD, JUNK, SPAM, UNQUALIFIED, ARCHIVED, DISQUALIFIED`
   (compared upper-cased and trimmed).
2. **Has the customer already answered?** Look for the newest **inbound** `communication_logs` row
   for this person created **after the enrolment timestamp**, limit 1.
   *Stop* if there is one — a human conversation has started and a drip must not talk over it.

If both answers are good, the send proceeds exactly as before. If either is bad, the run leaves the
main chain, writes **one** `audit_log` row saying which gate stopped it and why, and ends. No
partial sends, no second row, no silent death.

The enrolment timestamp is stamped **once**, in `Normalize Lead Input` (`enrolled_at`), not
recomputed per gate — otherwise the goalposts would move forward every time a gate ran and a reply
received on day 2 would stop being visible to the day-5 gate.

---

## 3. Identity matching

`communication_logs.lead_email` is a mixed column. `Resolve Lead Identity` in
`whatsapp_bdc_ai_agent.json` writes the lead's real email when it can match the sender's phone
against `leads`, and falls back to the raw WAHA chat id (`<digits>@c.us`, or `<opaque>@lid`) when it
cannot; `nexus_master_lead_router_ai_agent.json` synthesises `+<digits>@whatsapp.lead` as an email
for phone-only leads.

The reply lookup therefore matches on **all plausible keys at once**, using the same PostgREST
`or=(...)` construction as `Fetch Thread History` (`whatsapp_bdc_ai_agent.json`, node at `[704,-320]`):

```
or=(lead_email.eq.<lead email>,lead_email.eq.<digits>@c.us,lead_email.eq.+<digits>@whatsapp.lead)
```

deduplicated with a `Set` (a phone-only lead's email *is* `+digits@whatsapp.lead`, which would
otherwise appear twice). The digits come from the **resolved** phone — the leads-table value, not the
payload — so this works for dashboard enrolments that carry no phone at all.

`@lid` handles carry no phone digits and cannot be synthesised from anything in `leads`; that blind
spot is stated in `RISKS.md`, not papered over.

---

## 4. The phone lookup

`Lead State (Day N)` selects `id,name,email,phone,status`, so the gate that guards a send also
supplies the number that send needs. No extra node, and no dependence on the caller.

One canonical resolver is used in **five** places — both `Has WhatsApp?` gates, both WAHA `chatId`
expressions, and `Delivery Report`'s `hasWhatsApp`:

```js
(() => {
  const pick = (n) => { try { const v = $(n).first().json.phone; return v ? String(v).trim() : null; }
                        catch (e) { return null; } };
  return pick('Lead State (Day 5)') || pick('Lead State (Day 1)') || pick('Normalize Lead Input');
})()
```

Freshest first, payload last. `$('Lead State (Day 5)')` *throws* on the day-1 pass rather than
returning undefined — the same trap `Normalize Lead Input` documents for `$('DripWebhook')` — so
each probe is wrapped, which is the established pattern in this repo (`lead_escalation_ai_agent.json`,
`whatsapp_bdc_ai_agent.json`).

Updating `Delivery Report` matters: without it, a dashboard-enrolled lead is judged "email-only", the
WhatsApp legs are never verified, and the run reports SUCCESS while a WAHA failure goes unnoticed.

---

## 5. Node-by-node flow after the change (36 nodes)

```
Called by Master Router ─┐
DripWebhook → Verify JWT ─┴→ Normalize Lead Input (+ enrolled_at)
   → Audit: Enrolled                                    ← NEW  roster row, written now
   → Wait Day 1
      → Lead State (Day 1) → Replies Since Enrol (Day 1) → Still Enrolled? (Day 1)   ← NEW gate
          ├ true  → Email: Welcome → Log Welcome Email → Has WhatsApp?(D1)
          │            ├ true → WhatsApp: Welcome → Log WhatsApp Welcome ─┐
          │            └ false ───────────────────────────────────────────┴→ Wait Day 3
          └ false → Stopped Report                                              ← NEW
      → Lead State (Day 3) → Replies Since Enrol (Day 3) → Still Enrolled? (Day 3)   ← NEW gate
          ├ true  → Email: Follow Up → Log Follow Up Email → Wait Day 5
          └ false → Stopped Report
      → Lead State (Day 5) → Replies Since Enrol (Day 5) → Still Enrolled? (Day 5)   ← NEW gate
          ├ true  → Has WhatsApp?(D5) → [WhatsApp: Check-in → Log] → Wait Day 7
          └ false → Stopped Report
      → Lead State (Day 7) → Replies Since Enrol (Day 7) → Still Enrolled? (Day 7)   ← NEW gate
          ├ true  → Email: Final Offer → Log Final Offer Email → Delivery Report ─┐
          └ false → Stopped Report ────────────────────────────────────────────────┴→ Audit Log
```

### The 14 new nodes

| Node | Type | Purpose |
|---|---|---|
| `Audit: Enrolled` | httpRequest 4.2 | POST `audit_log` at enrolment: `status: 'ENROLLED'`, `logged_at: $json.enrolled_at`. Makes the dashboard roster truthful from minute one. |
| `Lead State (Day 1/3/5/7)` | httpRequest 4.2 ×4 | GET `leads?select=id,name,email,phone,status&email=eq.<email>&limit=1`. Answers "still live?" and supplies the phone. |
| `Replies Since Enrol (Day 1/3/5/7)` | httpRequest 4.2 ×4 | GET `communication_logs?direction=eq.inbound&created_at=gt.<enrolled_at>&or=(...)&order=created_at.desc&limit=1`. Answers "have they answered?" |
| `Still Enrolled? (Day 1/3/5/7)` | if 2.3 ×4 | One boolean. `true` → send, `false` → `Stopped Report`. |
| `Stopped Report` | code 2 | The single exit path. Works out which gate stopped the run and why, and builds `delivery{}` in the existing shape. |

### The 7 modified nodes

| Node | Change |
|---|---|
| `Normalize Lead Input` | adds `enrolled_at: new Date().toISOString()` to the emitted item. Nothing else touched — the entry-path resolution, the auth guard and both error messages are left exactly as they are. |
| `Has WhatsApp? (Day 1)` / `(Day 5)` | test the resolved phone instead of the payload phone. |
| `WhatsApp: Welcome` / `Check-in` | build `chatId` from the resolved phone. Message text unchanged. |
| `Delivery Report` | resolves `hasWhatsApp` the same way; emits `lead_name` / `lead_email` explicitly so the completion audit row can be attached to a person. |
| `Audit Log` | one node, two callers: `summary` becomes `'Stopped before <step> - ' + note` when `exit_reason` is present, otherwise the unchanged `'Completed - ' + note`. |

---

## 6. What happens in each exit case

`Stopped Report` identifies the gate that stopped the run as **the last `Lead State (Day N)` node
that executed** (`$('...')` throws for a node that never ran, which is the signal). Simulated against
the real code:

| Case | `exit_reason` | `delivery.status` | `verified[]` | `dropped[]` |
|---|---|---|---|---|
| Replied by WhatsApp on day 2, gate fires day 3 | `the customer replied on 2026-08-21T04:12:00Z by whatsapp, so a person is already in the conversation` | `PARTIAL` | the 4 day-1 steps | the 6 day-3/5/7 steps, each with the reason |
| Status flipped to `WON` before day 1 | `the lead status is WON, which is terminal` | `PARTIAL` | *(empty — nothing had been sent)* | all 10 steps |
| Lead row deleted before day 5, **and** the day-3 mail had failed | `the lead row no longer exists in the leads table` | `FAILED` | 5 of the 6 attempted steps | `Day 3 follow-up email — Gmail 401 invalid_grant` + the 4 remaining steps |
| Email-only lead (no phone anywhere), `LOST` before day 3 | `the lead status is LOST, which is terminal` | `PARTIAL` | the 2 day-1 email steps | the 4 remaining email steps — WhatsApp steps correctly not claimed |

**Why an exit is `PARTIAL` and not `FAILED`.** `Stopped Report` uses `Delivery Report`'s `check()`
function and status ladder verbatim, so the vocabulary means one thing across the workflow: `FAILED`
is reserved for a step that was *attempted and did not land*. `campaigns.js:355` counts `FAILED` and
`REJECTED` rows as failures against the lead and renders a red "N failed" chip — a customer who
bought the car is not a failure. A stop always leaves something unsent, so an exit is `PARTIAL`
unless an earlier send genuinely failed, in which case it is `FAILED` for that reason and the reason
is printed.

`Stopped Report` deliberately does **not** spread `$input`. The item arriving from the gate is a
`communication_logs` row carrying its own `lead_email` — which can be a WhatsApp chat id. Spreading
it would file the stop row under a different key from the enrolment row and split one person into two
on the roster. Identity is taken from `Normalize Lead Input`, explicitly.

---

## 7. Why this shape, and not a single shared gate

**Chosen: one design, instantiated four times.** Three nodes per gate — two reads and one IF —
byte-identical across all four except the day number in the node names. The IF holds one boolean and
no prose; all of the reasoning lives once, in `Stopped Report`.

n8n has no functions, so the alternatives were:

* **One shared gate + a `Switch` routing back into the chain.** Fewer nodes (7 instead of 12), but the
  gate would then sit both upstream and downstream of itself — a cycle through four `Wait` nodes.
  Every `$('Lead State')` lookup, including the six in `Delivery Report`, becomes "which run of that
  node?", and n8n resolves that by run index, not by intent. It also needs a `Set` node per phase to
  stamp which leg is live. That is more moving parts and less legible, not fewer.
* **One `rpc/drip_should_continue` Postgres function**, collapsing each gate to 1 HTTP + 1 IF (8 nodes
  total). This is the right long-term shape and is recommended — but it needs a database migration
  that cannot be written or verified from files alone, so it is not part of this change.
* **Folding the terminal-status test into the query** (`status=not.in.(WON,LOST,…)`) — rejected. It
  makes "terminal" and "deleted" both return zero rows, and the audit row could no longer say which
  it was. The requirement is to distinguish them, so the status test lives in the IF.

**Maintainability, stated plainly:** the four gates are copies, and copies drift. The three
expressions below are the canonical text; changing one means changing all four, and there is no
mechanism in n8n that will enforce it.

1. the terminal-status list, in each `Still Enrolled?` condition,
2. the `or=(...)` identity filter, in each `Replies Since Enrol` node,
3. the phone resolver, in five places.

Each new node carries a `notes` string saying it is one of four identical copies. A drift check that
costs nothing: `get_workflow_details` and diff the four `Still Enrolled?` conditions with the day
number normalised — they must be character-identical.

---

## 8. Positions, and `executionOrder: v1`

Under `v1`, when one output has **several** targets, n8n runs them in ascending target `y`
(then `x`). The layout is built so that this never has to be reasoned about:

* **The main lane is `y = 304`**, left to right, 160 px apart. Each gate's three nodes sit inline on
  that lane between the `Wait` and the send it guards, so the chain reads in run order.
  Existing nodes shift right to make room (`Wait Day 1` 592 → 720, `Email: Welcome` 736 → 1360,
  `Wait Day 3` 1120 → 2160, `Wait Day 5` 1456 → 3120, `Wait Day 7` 1856 → 4240,
  `Email: Final Offer` 2064 → 4880, `Delivery Report` 2272 → 5200, `Audit Log` 2208 → 5440).
  Positions are cosmetic to n8n but not to the person who has to read this at 3 a.m.
* **WhatsApp legs stay above the lane** (`y = 80`), **communication_logs writes stay below**
  (`y = 656`) — the existing convention, preserved.
* **`Stopped Report` is at `y = 880`, below everything.** The exit lane is the lowest thing on the
  canvas, so an exit branch is never confused with a send branch, and if any output ever gains a
  second target, `v1` will run the main-lane work before the exit.
* **`Delivery Report` (`y = 456`) is above `Stopped Report` (`y = 880`)**, and both feed `Audit Log`.
  Only one can fire per execution, but the ordering is deterministic and favours the completion row.
* **`Audit: Enrolled` is in series, not fanned out.** `Normalize Lead Input → Audit: Enrolled →
  Wait Day 1`, not two branches off `Normalize`. With a fan-out, v1 would decide by `y`, and one
  mis-drag putting `Wait Day 1` above `Audit: Enrolled` would mean the enrolment row is not written
  until the execution *resumes* — which is precisely the bug being fixed. In series, order is not a
  matter of geometry.
* **No two nodes share a position** (checked), so nothing is hidden underneath anything else.

---

## 9. Cost on the box (GCP e2-micro, 1 vCPU, 958 MB, concurrency 2)

Per enrolment the change adds **9 HTTP round trips spread over 7 days** (1 audit insert at enrolment
+ 8 gate reads), all against Supabase, all `limit=1`, none using `returnAll`. The
`communication_logs` reads are covered by `idx_comm_logs_lead_email` and `idx_comm_logs_created_at`
(`supabase/create_missing_tables.sql:77-78`).

Nothing new runs inside a `Wait` window: a suspended execution costs nothing until it resumes, and
each resume now does two small reads before the send it already did. Concurrency 2 is unchanged —
the added nodes are sequential within one execution, never parallel.

`executionTimeout` is **not** touched. This workflow deliberately has none; adding one would cut
every enrolment off four minutes into the first wait (`campaigns.js:115-119`).

---

## 10. Credentials

Every new HTTP node uses `authentication: predefinedCredentialType`, `nodeCredentialType:
supabaseApi`, and the credential block:

```json
"credentials": { "supabaseApi": { "id": "<<SUPABASE_CRED_ID>>", "name": "Supabase account" } }
```

* **Credential type: `supabaseApi`** (n8n's "Supabase API" credential — host + service-role key).
* Replace `<<SUPABASE_CRED_ID>>` with the live id before applying. Every existing Supabase node in
  this workflow uses **`dv4OeARarErZLHCj` / "Supabase account"**; confirm with `list_credentials`.
* n8n connects with the service-role key, which bypasses RLS
  (`supabase/create_missing_tables.sql:86-88`), so the gate reads on `leads` and
  `communication_logs` need no policy change.

---

## 11. Node settings (separate `setNodeSettings` operations — they cannot go inside `addNode`)

| Nodes | `retryOnFail` | `maxTries` | `waitBetweenTries` | `alwaysOutputData` | `onError` |
|---|---|---|---|---|---|
| the 8 gate reads | `true` | 3 | 2000 | **`true`** | **`stopWorkflow`** |
| `Audit: Enrolled` | `true` | 2 | 1500 | – | `continueRegularOutput` |

`alwaysOutputData: true` is load-bearing on both read nodes. Zero rows is the *normal* result for
`Replies Since Enrol`, and a node that emits nothing stops its branch dead — the sequence would
vanish with no audit row and no error. With it on, a zero-row read emits one empty item, the IF sees
`{}`, and the exit is explicit.

`onError: stopWorkflow` on the reads is the deliberate choice to **fail closed**. If Supabase is
unreachable after three tries, the execution fails, the configured `errorWorkflow`
(`iYJkh1kztWxZXDbT`) fires and `saveDataErrorExecution: all` keeps the evidence — and **nothing is
sent**. The alternative (`continueRegularOutput`) would hand the IF an `{error: …}` item, which reads
as "lead row gone" and would report a database blip as a customer outcome. Silence is recoverable;
mailing a "5% discount, valid 48 hours" to somebody who already paid is not.

`Audit: Enrolled` is the opposite: `continueRegularOutput`, matching the existing `Audit Log` node,
because a failed bookkeeping write must never kill a live drip.

---

## 12. Applying it

```
mcp__n8n__update_workflow
  workflowId: "G7FhvMY2ucW5Fg7X"
  versionName: "Add per-send exit gates, DB phone lookup, enrolment audit row"
  operations: <the array in OPERATIONS.json, after replacing <<SUPABASE_CRED_ID>>>
```

76 operations, ordered `addNode` → `setNodeSettings` → `setNodePosition` → `removeConnection` →
`addConnection` → parameter edits. The call is atomic: if any operation fails, nothing is saved.
Then follow the post-apply checklist in `RISKS.md` — in particular, **check for suspended executions
first**.
