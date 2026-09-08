# V1 closure — n8n box, pass 2

**Run:** 6 September 2026, 14:33–15:05 UTC. Sole agent on the production n8n box
(`35.224.126.225`) for the duration. Production Supabase `dsvuoovivysszdoiorch`.
Continues `/home/claude/out/v1-closure-n8n.md`.

**Verdicts at a glance**

| task | subject | verdict |
|---|---|---|
| 1 | Anonymous callers stamp ALBA CARS on 8 of 9 endpoints | **PASS** — 8/8 fixed, measured before and after; 9/9 now quarantine |
| 1′ | A legitimate request still stamps the correct dealership | **PASS** — live, on real traffic |
| 2 | Phase 6 node ordering; retire-and-stop loop | **PASS — and published.** Marker written, lead retired, second run does nothing |
| 3 | `deals/closed-won` answers 200 with an empty body on rejection | **PASS** — now 401 + JSON body; success path unchanged |

**What changed on the box:** nine workflows edited and published — the shared
error handler, six auth gates, `deals/closed-won` (rejection branch), the
finance calculator's tenant resolver, the escalation sub-workflow's node
ordering, and Phase 6 published for the first time. One `workflow_registry`
field corrected. No credential, no secret and no env var was touched.

---

## Task 1 — eight endpoints stamped an anonymous caller to ALBA CARS: **PASS**

### It was two writers, not eight

The first thing worth recording is that the defect was **not** eight separate
workflows each getting tenancy wrong. Read from the audit rows the previous pass
left behind, the eight ALBA-stamped rows came from exactly **two** writers:

| endpoint | who wrote the row |
|---|---|
| `audit-kyc`, `deals/closed-won`, `erp-sync`, `lead-escalation`, `lead-trigger`, `nexus-inbound-lead`, `slack-command` | **the shared `NEXUS Error Handler`** (`iYJkh1kztWxZXDbT`) — their gates `throw`, and the error workflow logs the failure |
| `finance-calc` | **its own `Audit Log` node**, because its gate *returns* an error item instead of throwing |

`whatsapp-send` refuses correctly and has **no audit node at all** — that is why
ten refusals produced nine rows.

### `ask-ai`'s mechanism, copied rather than reinvented

`Audit Log` on `qHAtd3RckAKRBUkE`:

```js
let t = null, src = 'unknown';
try { const e = $('Extract Question').first().json; t = e.tenant_id || null; src = e.tenant_source || 'unknown'; }
catch (err) { t = null; src = 'unauthenticated'; }
...
return JSON.stringify(t ? Object.assign(base, { tenant_id: t }) : base);
```

The mechanism is **omit the `tenant_id` key entirely** when the tenant is
unresolved, and let the column's own default place the row. Confirmed against
the live schema: `audit_log.tenant_id` is `NOT NULL DEFAULT nexus_default_tenant_id()`,
and `select public.nexus_default_tenant_id()` returns `02c86264-…`, the
quarantine tenant. Omit → quarantine. That is the whole contract.

### Why the error handler could not simply copy it verbatim

The error handler's node already knew it could not attribute — its own note says
*"an error trigger reports which workflow failed, not whose customer it was"* —
and then named ALBA anyway, because with `NEXUS_TENANT_MAP` unset its built-in
one-key map made `sole configured dealership` resolve.

**Blanket-omitting there would have been worse than the defect.** Measured over
30 days on production:

```
WhatsApp BDC AI Agent   161 FAILED rows,  0 unauthorized, 152 via the error handler
```

Those are genuine ALBA automation failures and they belong on ALBA's Automation
screen. A blanket omit would have moved all 152 into quarantine and blinded the
dealership to its own broken automations.

So the handler had to **discriminate**, and an Error Trigger's payload carries
only `{execution:{id,url,retryOf,error,lastNodeExecuted,mode}, workflow:{id,name}}`
— no run data. The one field the failing workflow controls is the error message.

### The contract, and the measurement that shaped it

Each gate now prefixes its unauthorized throw with `[NEXUS-UNATTRIBUTED]`.

The first attempt put the marker at the head of the throw and had the handler
test the summary — and it **did not work**. Measured on execution `10487`:

```
description : "[NEXUS-UNATTRIBUTED] ERP sync rejected"
message     : "unauthorized. A valid Supabase session token is required … [line 18]"
stack       : "Error: [NEXUS-UNATTRIBUTED] ERP sync rejected: unauthorized. …"
```

**n8n's Code node splits a thrown `"A: B"` into `error.description = "A"` and
`error.message = "B [line N]"`.** The summary is built from `message`, so the
marker never reached it. (This also explains a detail nobody had noted: every
gate's own prefix — "ERP sync rejected", "KYC upload rejected" — has been
invisible in the audit trail all along.)

`Build Failure Row` now derives a boolean from **both** fields at position 0:

```js
const M = '[NEXUS-UNATTRIBUTED]';
const e = ($json.execution && $json.execution.error) || $json.error || {};
return String(e.description || '').indexOf(M) === 0 || String(e.message || '').indexOf(M) === 0;
```

Position 0 rather than "contains", so a copy of the marker embedded in a
caller-supplied payload cannot push a genuine dealership failure into quarantine.

### A second, latent defect closed by the same line

The old writer sent `tenant_id: t` **explicitly, including as `null`**. The
column is `NOT NULL`. So the moment `NEXUS_TENANT_MAP` held two keys, `t` would
have become `null`, every insert would have failed `23502`, and **every workflow
failure row on the box would have been silently lost**. The writer now omits the
key instead of sending null, which both routes to quarantine and removes that
cliff.

### finance-calc: a different door to the same room

Its `Audit Log` node was **already** using ask-ai's omit pattern correctly. The
defect was upstream: `Calculate Equity & Tier` refuses an unauthenticated caller
by *returning* an error item, so the item flowed on to `Resolve Tenant`, whose
`sole_configured_tenant` fallback named ALBA. `Resolve Tenant` now detects
"arrived over the public webhook AND `Verify JWT` produced no user" and skips the
fallback — `tenant_source: 'unauthenticated'`, tenant null, key omitted. The tool
path and the authenticated webhook path are untouched.

### Before and after, per endpoint — live, unauthenticated, from outside the VM

`POST` with `{"nexus_probe":"…"}`, no `Authorization` header.
Before: 14:35:03–14:35:27Z. After: 14:45:26–14:45:56Z. Confirming sweep:
15:02:20–15:02:58Z.

| # | endpoint | writer | HTTP (before → after) | row landed BEFORE | row landed AFTER |
|---|---|---|---|---|---|
| 1 | `audit-kyc` | error handler | 500 → 500 | **ALBA CARS** | **QUARANTINE** |
| 2 | `deals/closed-won` | own node (new) | 200 empty → **401 JSON** | **ALBA CARS** | **QUARANTINE** |
| 3 | `erp-sync` | error handler | 200 → 200 | **ALBA CARS** | **QUARANTINE** |
| 4 | `finance-calc` | own node | 200 → 200 | **ALBA CARS** | **QUARANTINE** |
| 5 | `lead-escalation` | error handler | 500 → 500 | **ALBA CARS** | **QUARANTINE** |
| 6 | `lead-trigger` | error handler | 200 → 200 | **ALBA CARS** | **QUARANTINE** |
| 7 | `nexus-inbound-lead` | error handler | 200 → 200 | **ALBA CARS** | **QUARANTINE** |
| 8 | `slack-command` | error handler | 200 → 200 | **ALBA CARS** | **QUARANTINE** |
| — | `ask-ai` (control) | own node | 401 → 401 | QUARANTINE | QUARANTINE |
| — | `whatsapp-send` | writes no audit row | 200 → 200 | (none) | (none) |

**8 of 8 moved. 9 of 9 endpoints that write a row now file it under quarantine.
Zero anonymous rows reach ALBA CARS.**

Every HTTP status and every response body is unchanged except `deals/closed-won`,
which is Task 3.

### The negative controls — a fix that quarantines real traffic would be worse

Three, in increasing order of strength.

**(a) The discriminator, on a simulated genuine failure** (execution `10506`, the
published handler, a `WhatsApp BDC AI Agent` failure at `Log Incoming Message`):

```
summary      : "The service was not able to process your request · Failed at node: …"
unattributed : false          ->  t stays ALBA CARS, tenant_id sent
```

**(b) Injection resistance** (execution `10507`): an error whose *message*
contains `[NEXUS-UNATTRIBUTED]` mid-string, as caller-supplied payload text would:

```
unattributed : false          ->  a real dealership failure is NOT pushed to quarantine
```

**(c) Real, live, legitimate traffic — the one that actually matters.** The
Phase 6 run in Task 2 is a genuine internal escalation through
`KI6P1Qcf3MIZakNa`, a workflow I edited. It wrote, at 14:55:

```
audit_log       Lead Escalation           SUCCESS   -> ALBA CARS
audit_log       Phase 6 Silence Detector  SUCCESS   -> ALBA CARS
communication_logs  [SILENCE-ESCALATED]   internal  -> ALBA CARS
```

Legitimate work still stamps the correct dealership, on production, after the change.

**One honest limit.** I could not exercise the *dashboard's* signed-in path
end to end, because that needs a real Supabase user JWT and I do not handle
secrets. What I did instead: for `deals/closed-won` I drove the authenticated
branch with a pinned verified user (execution `10521`) and observed
`Auth OK?` take output 0 into `Format Deal Text`, which produced
`tenant_id: fff6a2b5-… , tenant_source: 'jwt_tenant_member'` — the correct
dealership by the correct signal. For the other seven, the edit is confined to
a string literal *inside* `if (!auth.id) { … }`, which an authenticated request
cannot reach.

### Quarantine census after the pass

```sql
select * from public.nexus_quarantine_census();   -- audit_log, 20 rows
```

**All 20 are accounted for and none indicates a broken writer.** They are my own
probes (18), plus the previous pass's `ask-ai` probe and one reachability check:

| workflow | status | rows |
|---|---|---|
| Ask-AI RAG Query | REJECTED | 3 |
| wf_108 ERP Sync | FAILED | 3 |
| the other seven | FAILED / REJECTED | 2 each |

**A note for whoever reads the census next.** `nexus_tenancy_readiness()`
reports these under *"rows are sitting in the quarantine tenant — a live write
path is still omitting tenant_id … Find the writer, fix it"*. That wording now
under-describes the design: since this pass, a **refused anonymous request is
supposed to land there**, and the census cannot tell that apart from a workflow
that forgot its `tenant_id`. Read the `summary` — a deliberate quarantine row
ends in `TENANT UNRESOLVED (unauthenticated)`. That WARN will now be permanently
non-empty on any box exposed to the internet, and that is correct.

```sql
select * from public.nexus_tenancy_readiness();   -- 0 BLOCKERs, 3 WARN, 4 INFO
```

Unchanged in severity by this pass.

### Changed and published

| workflow | id | published version |
|---|---|---|
| NEXUS Error Handler | `iYJkh1kztWxZXDbT` | `3749646a-a723-4f80-bb16-7045456d3f27` |
| KYC/AML Document Auditor | `qTnh3nwWheFJbFkU` | `0a6b0e44-208f-40d7-ade2-043a9c9b3e1f` |
| wf_108 ERP Sync | `bxNBzBrcOtcFpMPn` | `d44d1456-6b3e-45ac-b2f5-22dbdb3162a5` |
| Master Lead Router | `JnlZFAVmFAuNXVya` | `82a4d250-abc8-4463-ae7d-f7f4892e2bf4` |
| Slack Command Center | `VmnIXo7tM30zqawp` | `4b5ebacf-ce38-4765-890f-8a6ded457df4` |
| 7-Day Warm Lead Drip | `G7FhvMY2ucW5Fg7X` | `bdcca937-8d5e-468b-9481-0a927747d89c` |
| Finance Calc | `unMMpeL9uuPO79pp` | `c7b0f176-f0b8-4504-995e-1014522f890b` |
| Sync Closed-Won | `dhy2DDjWUqwuzHLW` | `17183327-c7bf-42f3-8f52-d8a0a45e9594` |
| Lead Escalation | `KI6P1Qcf3MIZakNa` | `84ecf1a4-5e68-4f9e-b64d-3e6677ffcc38` |

In `lead-trigger`, the two *"no lead supplied"* throws are deliberately **not**
marked — a lead arriving with no email is the dealership's own automation
misfiring and belongs on its Automation screen.

### Rollback

Per workflow: restore the immediately preceding version in n8n's version
history. The eight gate edits are independent of one another; the handler edit
is the only shared one, and reverting it alone returns every endpoint to
stamping ALBA.

---

## Task 2 — Phase 6 node ordering: **PASS, and published**

### The defect, confirmed exactly as inherited

`Fetch Rep Slack Id` hung off `Fetch Escalated Lead` as a parallel branch with
**no downstream connection at all**. Under `executionOrder: v1` that made it the
last node in the run — `executionIndex 18`, after `Return Result` at 15 and 17 —
so *its* output was what `Trigger Lead Escalation` read back through
`waitForSubWorkflow`. Lead 38 has `assigned_to_id: null`, the URL resolved to
`id=eq.` and Supabase answered `400 invalid input syntax for type uuid`. Phase 6
read `escalated !== true`, withheld the marker, and nothing retired the lead.

Its own note asserted the opposite of its behaviour — *"so it has always run by
the time the Slack node builds its text"* — which is why the missing @-mention
went unexplained for a week.

### The fix

1. **Ordering.** `Found The Lead? → Fetch Rep Slack Id → Attach Rep → Model Ladder`.
   The node now runs *before* both delivery legs and is no longer terminal.
   `Fetch Escalated Lead → Fetch Rep Slack Id` removed.
2. **The null is a handled case, not an exception.** A null or non-uuid
   `assigned_to_id` is substituted with the sentinel
   `00000000-0000-0000-0000-000000000000`, a well-formed uuid that legitimately
   matches no row. Zero rows is a normal answer meaning "this lead has no owner
   to mention" — the same guard `Fetch Escalated Lead` already uses for
   `tenant_id`.
3. **`Attach Rep`** (new Code node) re-attaches the lead — an HTTP node replaces
   the item — and normalises the lookup into `rep_slack_id` / `rep_name` /
   `rep_lookup`, tolerating both PostgREST array shapes.
4. **`Send a message`** reads `$('Attach Rep').first().json.rep_slack_id`.

`Return Result` keeps **both** inbound connections deliberately. If the email leg
ever dies before `Delivery Report`, the Slack-branch `Return Result` is the only
one that runs and reports `escalation_unverified / escalated:false` — the marker
is withheld and the lead stays in the safety net. That is the safe direction.

### Proof, in order

**Ordering, before publishing** (execution `10512`, pinned I/O, real graph):

```
Attach Rep        executionIndex 5    rep_slack_id: null
                                      rep_lookup: "lead has no assigned_to_id -
                                                   nobody is @-mentioned, and that is not an error"
Return Result     executionIndex 18 (from Delivery Report)  escalated: true
Return Result     executionIndex 20 (from Send a message)   escalated: true
lastNodeExecuted: "Return Result"     <- was "Fetch Rep Slack Id"
```

Both `Return Result` runs report the verified outcome, so the sub-workflow's
return value is the escalation outcome whichever runs last.

**The sentinel against the real Supabase API** (execution `10517`, live,
`mode: integrated`, nothing pinned):

```
Fetch Rep Slack Id   executionIndex 3   executionStatus: success   output {}   (zero rows, no 400)
Attach Rep           executionIndex 4
lastNodeExecuted:    "Return Result"
```

**Run 1 — a genuinely silent lead still escalates** (Phase 6 execution `10516`
→ sub-execution `10517`, 14:54:57–14:55:39Z, 42 s):

```
Trigger Lead Escalation -> escalated: true, delivery.status: SUCCESS
Escalation Landed?      -> TRUE branch
Mark as Escalated       -> ran
Delivery Report         -> SUCCESS, "all 2 claimed steps verified"
                           including "[SILENCE-ESCALATED] marker closing this silence episode"
```

**The marker is written, and to the right dealership:**

```
communication_logs 358ebebd-d148-4f3b-8477-8905cf7b2b23
  lead_email  shabbir53ujjainwala@gmail.com
  channel     system      direction  internal
  message     [SILENCE-ESCALATED] Silent for 103h since 2026-09-02T07:27:20.809284+00:00
  tenant      ALBA CARS (fff6a2b5-…)   -- NOT the quarantine tenant
  created_at  2026-09-06 14:55:39.266+00
```

```
audit_log   Phase 6 Silence Detector   SUCCESS   ALBA CARS   "all 2 claimed steps verified"
```

That row was **FAILED** on the previous pass. `direction='internal'`, so
`communication_logs where direction='internal'` goes 0 → 1.

**Run 2 — the lead is retired and does not re-escalate** (execution `10519`,
14:59:31Z, 1.8 s):

```
Find Silent Leads   ->  ZERO items
Trigger Lead Escalation  -- did not run
Mark as Escalated        -- did not run
```

No Slack message, no email, no OpenRouter call, no audit row. **The
retire-and-stop loop is proven end to end: run 1 escalates and marks, run 2 does
nothing.** That is the thing that made publishing wrong yesterday and safe today.

**The business symptom is cleared.** `v_lead_recovery` on all three leads:

```
silence_detector_state           CURRENT      (was STALE for every lead since 26 Aug)
silence_detector_last_run_at     2026-09-06 14:55:39.408+00
silence_detector_last_run_class  SUCCESS
```

### Published

```
Lead Escalation - AI Agent   KI6P1Qcf3MIZakNa  active version 84ecf1a4-5e68-4f9e-b64d-3e6677ffcc38
Phase 6 Silence Detector     B3TcpfzOMWj8oWgF  active version 1676e7ad-bd73-4890-8683-28592b11a3e5
```

Both fetched back and verified against the **published** definition, not the
draft. Phase 6 had `activeVersionId: null` since 28 July; it is now `active: true`
with a schedule trigger, and `workflow_registry.is_active = true` is finally true
of the box. **No registry edit was needed** — the disagreement the previous pass
deliberately left in place was resolved by fixing the workflow, which is what it
asked for.

**Phase 6 itself was not modified.** The published definition is byte-identical
to the draft that produced runs 10516 and 10519.

### What publishing turns on, bounded

One hourly run. With one open lead and its marker on file, the run is three
Supabase reads and an exit — 1.8 s, no writes, no sends, no LLM call. It only
does work when a lead genuinely goes silent again.

### What I did NOT fix, and why

- **`MAX_PER_RUN = 8` against a 300 s `executionTimeout`.** Today's escalation
  took 39 s; the previous pass measured 3 m 45 s for one. Eight at 40 s is ~320 s
  and would be cut mid-loop. I left it alone: the failure mode is **bounded and
  self-correcting** — a lead escalated but not marked re-escalates on the next
  hourly run and is marked then, not forever — production has exactly **one** open
  lead, and narrowing working detector logic for an unmeasured risk buys nothing.
  Worth revisiting the day the lead book grows.
- **The fabricated EMI is still in the escalation brief.** The AI wrote
  *"Finance with salary transfer, ~AED 11 200 /mo over 60 mo"* into the audit
  summary and the email again today. This is the 31 August figure this project
  records as wrong (nearer 7,800). It is internal-only — Slack channel
  `C0BKTLL1X54` and Gmail to `aliasgher892@gmail.com`, **no customer is
  contacted by this workflow** — but the escalation path is still carrying a
  known-bad finance number into the owner's inbox, and publishing Phase 6 means
  it now does so on a schedule rather than only when someone presses Execute.
  Not in scope for this pass; it belongs to the finance-grounding work.
- **Marker re-arming (defect D3).** "A lead that goes silent *again* after a new
  outbound is escalated again" is pre-existing logic in `Find Silent Leads` that
  I did not touch and did not re-test — testing it would have meant writing a
  synthetic outbound row into a real customer's `communication_logs`, which would
  surface on the dealership's Conversations screen. The positive case that *was*
  proven is the one that matters here: a genuinely silent lead escalated, live,
  with the fix in place.

### Rollback

n8n editor → Unpublish `B3TcpfzOMWj8oWgF`; the hourly schedule stops immediately
and the box returns to yesterday's state. Narrower: restore
`KI6P1Qcf3MIZakNa`'s previous version to revert the ordering alone.

---

## Task 3 — `deals/closed-won` answered 200 with an empty body: **PASS**

### What it should answer, and why

The endpoint is called by `apps/executive-dashboard`, which sends a Supabase
session token. A request without a valid one is an authentication failure, and
this codebase already has a house answer for that: `ask-ai`'s `Respond 401` and
`whatsapp-send`'s `Respond Unauthorized` both return

```json
{"error":"Unauthorized","message":"A valid Supabase session token is required in the Authorization header."}
```

`deals/closed-won` now returns exactly that, with status **401**. No new
vocabulary was invented.

### Why it was empty

`Webhook - New Deal` uses `responseMode: responseNode`, and the auth check lived
*inside* `Format Deal Text` as a `throw`. A thrown execution reaches no Respond
node, so the caller got a bare `HTTP 200` with no body — a refusal that looked
byte-for-byte like a success.

### The change

`Auth OK?` (IF) inserted after `Tenant For JWT User`:

```
Tenant For JWT User -> Auth OK?  --[true]-->  Format Deal Text   (unchanged success path)
                                 --[false]--> Respond 401 -> Audit Rejection
```

`Auth OK?` reaches back to `Verify JWT` by name, because `Tenant For JWT User` is
an HTTP node and replaces the item. `Audit Rejection` writes a `REJECTED` row
with `tenant_id` **omitted**, so the refusal lands in quarantine — Task 1 and
Task 3 closed by the same branch. The `throw` inside `Format Deal Text` is kept
as a marked backstop for the manual/direct path.

### Measured

```
POST /webhook/deals/closed-won   (no Authorization header)
  before : HTTP 200   body: (empty)
  after  : HTTP 401   body: {"error":"Unauthorized","message":"A valid Supabase session token is required in the Authorization header."}
  audit  : ALBA CARS  ->  QUARANTINE
```

Reproduced on the confirming sweep at 15:02:31Z.

### The success path is unchanged — evidence

The Deals screen is live and works, so this is the half that mattered most.

**Measured** (execution `10521`, pinned verified user, real graph):

```
Auth OK?           output 0 carries the item, output 1 empty
Format Deal Text   ran from Auth OK? output 0
                   dealId "auto:…", amount_aed 585000, lead_id 38,
                   tenant_id fff6a2b5-… , tenant_source "jwt_tenant_member"
Respond 401        did not run
Audit Rejection    did not run
```

**Diffed against the published definition**: every node from `Format Deal Text`
onward is unchanged, and `Respond to Webhook` still returns
`{{ $('Delivery Report').first().json }}` — the same body, from the same node, on
the same status. The only graph edits are the one connection moved
(`Tenant For JWT User → Auth OK?` in place of `→ Format Deal Text`) and the two
new nodes on the false branch.

**Honest limit:** the run stopped at `Parse Embedding Response` because my pinned
embedding had 3 dimensions and that node correctly refuses anything but 1536 — a
test-fixture artefact, and incidentally a demonstration that the
poisoned-vector guard works. I did not drive a real closed-won submission
through to `Respond to Webhook`, because that needs a real user JWT.

### Rollback

Restore the previous version of `dhy2DDjWUqwuzHLW`. The endpoint returns to
200-with-empty-body on refusal; the success path is unaffected either way.

---

## Blocked on the owner

Nothing in these three tasks is blocked. The items below are inherited from the
previous pass and are unchanged by this one.

| # | what Ali must do | unblocks |
|---|---|---|
| 1 | **Identify `2.50.10.149`.** WhatsApp → Linked Devices shows device **8** beside device **12**. Then either add `x-nexus-webhook-secret` to its WAHA webhook `customHeaders`, or unlink it. | item 07, then item 6 |
| 2 | **`WAHA_WEBHOOK_SECRET` in `/opt/nexus/.env`**, `WAHA_WEBHOOK_ENFORCE` unset, restart n8n; make **both** WAHA hosts send the header; confirm `_gate` reads `MONITOR / header_present:true` from every source address on a real 1:1 message; **only then** enforce. Doing this in the n8n node instead of the VM env silently drops every real customer message. | the open `whatsapp-inbound` webhook |
| 3 | **`NEXUS_PROBE_KEY`** on the VM, if the on-demand probe URL is wanted. Do **not** set `NEXUS_PROBE_VERBOSE=true`. | the probe's GET endpoint |
| 4 | **Edge JWT validation in Caddy** for the nine dashboard paths, excluding `whatsapp-inbound` and `slack-command`. | item 5 — refusal before n8n is reached |
| 5 | **`NEXUS_TENANT_MAP` two-key switch rehearsed on staging** before dealership two. | onboarding |
| 6 | **Decide the fabricated EMI.** Phase 6 is now on a schedule, so the known-bad AED 11,200 figure reaches Ali's inbox hourly whenever a lead is escalated. Internal only; no customer sees it. | finance grounding |

Item 4 remains the one that would make Task 1 mostly moot: with a 401 at the
edge, an anonymous caller never starts an execution and never writes a row at
all. Until then, quarantine is the right place for the rows they do write.

---

## Two things a future reader should not trip over

- **Two node `notes` fields are now stale and I could not edit them.** The n8n
  MCP surface exposes node *parameters*, *settings*, *position* and
  *credentials*, but not `notes`, and re-creating the nodes would have dropped
  their bound Supabase credential. Both assert the opposite of their own code —
  exactly the failure this project's house rules name:
  - `NEXUS Error Handler` / `Log Failure to audit_log`: *"tenant_id is sent
    EXPLICITLY, including as null. It is not omitted"*. It is now omitted when
    the caller was never authenticated, deliberately.
  - `Lead Escalation` / `Fetch Rep Slack Id`: *"Parallel branch off Fetch
    Escalated Lead so it has always run by the time the Slack node builds its
    text."* It is no longer a parallel branch, and that sentence was false when
    it was written. The correct account is in the `Attach Rep` node beside it and
    in both version descriptions.
- **`workflow_registry` correction.** `NEXUS Error Handler` carried
  `writes_audit_log = false` while being the writer behind 152 of the last 30
  days' FAILED rows. Set to `true`. One field, one row; no other production write
  was made.

## Standing checks, after this pass

```sql
select * from public.nexus_quarantine_census();   -- audit_log, 20 rows, all probes, all mine
select * from public.nexus_tenancy_readiness();   -- 0 BLOCKERs, 3 WARN, 4 INFO
select * from public.v_lead_recovery;             -- silence_detector_state = CURRENT on all 3 leads
```
