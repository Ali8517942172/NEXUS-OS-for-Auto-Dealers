# V1 closure — n8n box, items 4–7

**Run:** 6 September 2026, 14:11–14:30 UTC. Sole agent on the production n8n box
(`35.224.126.225`) for the duration. Production Supabase `dsvuoovivysszdoiorch`.

**Verdicts at a glance**

| item | subject | verdict |
|---|---|---|
| 4a | Publish NEXUS Infra Health Probe (`57QpbNQGwlFKb0q3`) | **PASS** |
| 4a′ | Prove the probe detects a broken channel | **PASS** |
| 4a″ | Prove a scheduled FAIL reaches `audit_log` end to end | **NOT RUN** — requires stopping live WAHA |
| 4b | Publish Phase 6 Silence Detector (`B3TcpfzOMWj8oWgF`) | **FAIL — publish withheld.** The workflow is defective; measured, not predicted |
| 5 | Authentication control on the 11 business POST webhooks | **BLOCKED on owner** for the control; **PASS** for the measurement (11/11 characterised, 11/11 refuse) |
| 6 | `channel_registry` tenant cutover on the live WhatsApp path | **BLOCKED on owner** — its stated precondition (item 07, the WAHA secret) is not met |
| 7 | Prove no caller-controlled value can override the resolved tenant | **PASS** — 8 attacks, 8 correct outcomes, zero rows |

**What changed on the box:** one workflow published (the probe), with its
`Probe Webhook` trigger node disabled. One `workflow_registry` row corrected.
Nothing else was published, activated, or edited. Phase 6 is exactly as it was
found: unpublished, `activeVersionId: null`.

---

## Item 4a — NEXUS Infra Health Probe: **PASS**

### What it does, read from the definition before publishing

12 nodes. Two triggers: `Every 15 Minutes` (schedule) and `Probe Webhook`
(GET `infra-probe`). Both converge on `WAHA Sessions` →
`GET http://waha:3000/api/sessions/default`, internal to the Docker network,
15 s timeout, `neverError`, `fullResponse`. `Format Probe` computes
`ok`/`verdict`/`reasons` field by field and withholds the connected number and
the WAHA webhook URL list unless `NEXUS_PROBE_VERBOSE=true` (unset).
`Probe Alarm` throws on FAIL, which n8n routes to the error workflow
`iYJkh1kztWxZXDbT`, which writes `audit_log`.

**What it writes:** nothing on a healthy channel. On an unhealthy one, one
`audit_log` row per alarm, `status='FAILED'`, `workflow='NEXUS Infra Health
Probe'`, de-duplicated to the 1st consecutive failure then every 8th (~2 h).
`saveDataSuccessExecution: "none"`, so the 96 daily runs accumulate no
execution rows.

**Can it spam or damage anything?** No. 96 internal HTTP GETs/day on the Docker
network; alarm rows are rate-limited by design; it holds no write credential of
its own beyond the error handler's.

### Detection proof — a genuine failure, twice, with production untouched

I could not stop the WAHA container: that takes the live WhatsApp channel down,
and real traffic is flowing (an inbound customer message landed at 14:13:54 UTC
mid-run). So the failure was induced at the **client** end, in the **draft**,
which was never published in that state, and the WAHA container was never
touched.

| # | induced failure | `Format Probe` verdict | `Probe Alarm` | execution |
|---|---|---|---|---|
| 10435 | none — baseline | `PASS`, `session_status: WORKING`, `webhook_count: 1` | `alarm: clear` | success |
| 10436 | URL → unresolvable host (real `ENOTFOUND`) | `FAIL`, `reasons: ["waha unreachable: getaddrinfo ENOTFOUND …"]` | **threw** `WAHA HEALTH PROBE FAIL (1 consecutive check)` | **error** |
| 10437 | URL → real WAHA, non-existent session (real HTTP 404) | `FAIL`, `reasons: ["waha http 404","session status unknown","no connected number","no webhooks configured"]` | **threw** | **error** |
| 10438 | reverted to `http://waha:3000/api/sessions/default` | `PASS` | `alarm: clear` | success |

Both failure shapes the code distinguishes — transport error and
HTTP/session error — were exercised with real network failures and both were
detected. Execution 10436 also confirms the routing: `Probe Passed?` took the
false branch into `Respond Degraded` (HTTP 503) before `Probe Alarm` threw.

**Limit, stated:** the alarm's de-duplication counter
(`$getWorkflowStaticData`) persists between *production* executions only. Both
failing runs reported "1 consecutive check", so the "every 8th" suppression
branch is **NOT RUN** — proving it needs 8 consecutive production failures,
i.e. a genuinely dead WAHA for two hours.

### The publish, verified against the published version

```
publish  -> activeVersionId 15e27fb5-ad38-4643-90b2-69d1d463f41b
fetch back: active=true, activeVersionId == versionId,
            activeVersion WAHA Sessions url == http://waha:3000/api/sessions/default
```
The detection-test URL never entered a published version.

### Then I closed a door the publish had opened

Publishing registered `GET /webhook/infra-probe`. Measured from **outside** the
VM, unauthenticated:

```
GET https://35.224.126.225.nip.io/webhook/infra-probe
-> HTTP 200
   [{"probe":"waha (GCP container)","ok":true,"verdict":"PASS","reasons":[],
     "session_status":"WORKING","number_connected":true,"webhook_count":1, …}]
```

That is `Probe Auth Gate` **dormant** because `NEXUS_PROBE_KEY` is unset —
measured, not inferred. This endpoint had never been reachable in its life
(`activeVersionId` was `null` since 14 August), so nothing could depend on it,
and leaving it open would have added a new anonymous, internet-reachable,
CPU-consuming endpoint to a box this project already records as CPU-starved.

I disabled the `Probe Webhook` trigger node and republished
(`activeVersionId 065bab55-29f3-426d-8bb8-95cd88b7f8d1`). Re-measured:

```
GET https://35.224.126.225.nip.io/webhook/infra-probe
-> HTTP 404  {"code":404,"message":"The requested webhook \"GET infra-probe\" is not registered."}
```

The schedule — the part that was actually missing — is untouched.

### Proof it is genuinely watching

`saveDataSuccessExecution: "none"` makes healthy scheduled runs invisible, so I
flipped it to `"all"` for one interval, captured the witness, and flipped it
back:

```
execution 10442  mode: "trigger"  started 14:15:03Z  status: success
  runtimeData.triggerNode = { name: "Every 15 Minutes", type: "scheduleTrigger" }
  Format Probe -> PASS, session_status WORKING
```

That run is **after** the webhook-disabled republish, so the published,
door-closed version is the one firing on its own schedule. **Something is now
watching the WhatsApp channel.** Setting restored to `"none"`; final state
`active: true`, `triggerCount: 1`.

### What a human sees

- **Healthy:** nothing. No rows, no executions. Silence is the PASS signal.
- **Unhealthy:** an `audit_log` row — `workflow = 'NEXUS Infra Health Probe'`,
  `status = 'FAILED'`, summary carrying the reasons and the failing node —
  which surfaces on the dealership's Automation screen alongside every other
  workflow failure. First failure, then roughly every two hours.

### Registry reconciled

The register asserted `is_active = true` for a workflow that had never been
published, and described it wrongly. Corrected:

```sql
update public.workflow_registry
   set trigger_type='schedule',
       trigger_detail='Every 15 minutes (schedule). GET /webhook/infra-probe trigger
                       is DISABLED until NEXUS_PROBE_KEY is set on the VM.',
       writes_audit_log=true
 where id='57QpbNQGwlFKb0q3';
```
`is_active = true` is now true of the box as well. `writes_audit_log` was
`false` and was wrong — it writes via the error workflow.

### Item 4a — BLOCKED on the owner

- **Set `NEXUS_PROBE_KEY` (24+ random chars) in `/opt/nexus/.env` and restart
  n8n**, then re-enable the `Probe Webhook` node and republish, if he wants the
  on-demand status URL back. Until then the schedule delivers the monitoring and
  no endpoint is exposed. **Do not set `NEXUS_PROBE_VERBOSE=true`** — once WAHA
  carries the webhook secret, `/api/sessions/default` returns it inside
  `config.webhooks[].customHeaders`, and verbose is the one path that could echo
  it outward.

### Rollback

n8n editor → Unpublish `57QpbNQGwlFKb0q3`. Schedule stops immediately. Narrower:
disable `Probe Alarm` to keep the verdict without the alarm.

---

## Item 4b — Phase 6 Silence Detector: **FAIL. Publish withheld.**

I did **not** publish it, and the reason is a measurement, not a worry.

### What publishing would have turned on

Read from the definition, then bounded against live data:
`Fetch Open Leads` (production holds **1** open lead — `leads` = 3, two
DISQUALIFIED), `Fetch Recent Comms` (115 rows in the 40-day window),
`Fetch WhatsApp Contacts` (12), `Find Silent Leads` (`MAX_PER_RUN = 8`), then
`Trigger Lead Escalation` → `KI6P1Qcf3MIZakNa` with `waitForSubWorkflow: true`.

**Correction to the runbook, which matters for blast radius.** File `08` says
the escalation "posts to Slack". Read from the published sub-workflow, it does
**two** things: `Send a message` (Slack channel `C0BKTLL1X54`) **and**
`Email: Escalation Alert (Gmail)` to a hardcoded `sendTo:
aliasgher892@gmail.com`. It also PATCHes `leads.escalated_at`. **No customer is
contacted on this path** — both legs reach Ali — which makes it far less
dangerous than the file implies, and is why running it once was proportionate.

### So I ran it once, manually and observed, before publishing

Execution `10443` (Phase 6) → `10444` (escalation sub-workflow), 14:17:02 →
14:20:48 UTC. One lead selected — id 38, `shabbir53ujjainwala@gmail.com`,
WARM, ai_score 65, silent 102 h since the last outbound on 2026‑09‑02 — exactly
as predicted from the data beforehand.

**Both delivery legs succeeded:**

```
Send a message                  -> { ok: true, channel: "C0BKTLL1X54", ts: 1788704447.760319 }
Email: Escalation Alert (Gmail) -> { id: "1a07717d5b420273", labelIds: ["UNREAD","SENT","INBOX"] }
Return Result                   -> escalated: true, delivery.status: "SUCCESS"
```

**And Phase 6 recorded it as a failure anyway:**

```
audit_log | Phase 6 Silence Detector | FAILED
  "1 of 2 claimed steps did not land | dropped: lead escalation actually
   delivered to a human — Bad request - please check your parameters"
```

### Root cause, from the execution

The sub-workflow's `lastNodeExecuted` is **`Fetch Rep Slack Id`**, and it
errored:

```
NodeApiError: Bad request - please check your parameters
description: invalid input syntax for type uuid: ""
```

Lead 38 has `assigned_to_id: null`, so the node queries on an empty uuid.
`Fetch Escalated Lead` fans out to both `Found The Lead?` and `Fetch Rep Slack
Id`, and under `executionOrder: v1` that node runs **last** — `executionIndex
18`, after `Return Result` at 15 and 17. Its error item therefore becomes the
sub-workflow's final output, so Phase 6's `Escalation Landed?` reads
`escalated !== true`, takes the false branch, and **withholds the
`[SILENCE-ESCALATED]` marker**.

Confirmed in the database: `communication_logs where direction='internal'` is
still **0**; `communication_logs` total unchanged at **116**.

### Why that makes publishing wrong today

The marker is the only thing that retires a lead from the safety net. It is
never written, so **the same lead is re-escalated every hour, indefinitely**:
one Slack message and one email to Ali per hour for the same lead, one
OpenRouter agent call per hour, one `FAILED` audit row per hour — and the Lead
Recovery screen keeps reading STALE because the marker never lands. That is
spam with no business outcome, and it is the precise thing I was asked to
satisfy myself could not happen.

Note the inversion: this workflow was rebuilt to stop a marker being written
when escalation *failed*. It now withholds the marker when escalation
*succeeded*. The safety-net gate is behaving correctly on the input it is
given; the input is wrong.

**A second latent defect from the same ordering:** `Send a message` reads
`$('Fetch Rep Slack Id')` at `executionIndex 16`, before that node runs at 18.
The expression's `catch` returns `''`, so **the rep is never @-mentioned** —
the Slack alert has always been untagged and always will be until the order is
fixed.

**A third, not triggered today:** the single-lead run took **3 m 45 s**.
`executionTimeout` is 300 s and `MAX_PER_RUN` is 8. Eight silent leads would
exceed the timeout mid-loop — leaving leads escalated but unmarked, which is
the failure the code's own comment warns about. Safe only because there is
one open lead.

### Two corrections to the inherited record

- **"It has never run" is false.** `communication_logs` holds **two**
  `[SILENCE-ESCALATED]` markers, `direction = 'outbound'`, `channel = 'system'`:
  `2026-08-26 19:03:18` and `2026-08-31 17:00:00.840` — the second exactly on
  the hour, i.e. a scheduled run. Phase 6 has run in production before. The
  `direction='internal'` count of zero reflects the *current* node's shape, not
  a workflow that never fired. Any check that keys on `direction='internal'`
  will miss the historical markers — including `VERIFY.md` §08.
- The escalation brief the AI produced and sent to Ali repeats
  **"monthly ~AED 11 200 over 60 mo"** — the fabricated EMI figure this project
  records from 31 August (the true figure was nearer 7,800). It is internal-only,
  so no customer saw it, but the escalation path is carrying a known-bad finance
  number into the owner's inbox.

### What my run changed, disclosed

- One Slack message to `C0BKTLL1X54` and one email to `aliasgher892@gmail.com`.
- `leads.escalated_at` for lead 38: `2026-08-31 04:06:38` → **`2026-09-06
  14:20:46`**. (`status` unchanged, still `WARM`.)
- Two `audit_log` rows (one `Lead Escalation / SUCCESS`, one
  `Phase 6 Silence Detector / FAILED`).
- **No** `communication_logs` row, **no** marker, **no** lead created.

### To clear item 4b — owner / next engineer

1. **Fix the ordering in `KI6P1Qcf3MIZakNa`.** Either give `Fetch Rep Slack Id`
   a guard for a null `assigned_to_id`, or move it so it runs *before*
   `Send a message` and *before* `Return Result`. Both defects — the false
   FAILED and the missing @-mention — come from that one node's position and
   its unguarded empty uuid.
2. Re-run manually and confirm `Escalation Landed?` takes the **true** branch,
   a marker row appears with `direction='internal'` and `tenant_id` =
   `fff6a2b5…` (never the quarantine tenant), and `audit_log` shows
   `Phase 6 Silence Detector / SUCCESS`.
3. Only then publish, in its own window, with a human watching
   `C0BKTLL1X54`.

**Registry left alone deliberately.** `workflow_registry` still says
`is_active = true` for `B3TcpfzOMWj8oWgF`, which the box contradicts. I did not
"fix" it by flipping the flag, because the disagreement is now the accurate
signal that a live screen depends on a workflow that does not work. Correcting
the row without fixing the workflow would hide the defect; publishing the
workflow would spam. **This one is genuinely Ali's decision**, and it is the
only remaining register/box disagreement.

---

## Item 5 — the eleven business POST webhooks

### Measurement: all eleven, live, unauthenticated, from outside the VM

One POST each, `{"nexus_probe":"v1-closure-item5"}`, 14:18:59–14:19:07 UTC.

| # | path | workflow | HTTP | execution created? | refused? | how |
|---|---|---|---|---|---|---|
| 1 | `ask-ai` | `qHAtd3RckAKRBUkE` | **401** | yes (10445, success) | **yes** | Respond node, `audit_log` REJECTED |
| 2 | `audit-kyc` | `qTnh3nwWheFJbFkU` | **500** | yes | **yes** | `Auth Gate` threw |
| 3 | `deals/closed-won` | `dhy2DDjWUqwuzHLW` | **200 (empty body)** | yes (10448, error) | **yes** | `Auth Gate` threw |
| 4 | `erp-sync` | `bxNBzBrcOtcFpMPn` | 200 "Workflow was started" | yes (10450, error) | **yes** | `Auth Gate` threw |
| 5 | `finance-calc` | `unMMpeL9uuPO79pp` | 200 + error JSON | yes (10452, success) | **yes** | `audit_log` REJECTED, "CALCULATOR DID NOT RUN" |
| 6 | `lead-escalation` | `KI6P1Qcf3MIZakNa` | **500** | yes (10453, error) | **yes** | `Auth Gate` threw |
| 7 | `lead-trigger` | `G7FhvMY2ucW5Fg7X` | 200 "Workflow was started" | yes (10455, error) | **yes** | `Auth Gate` threw |
| 8 | `nexus-inbound-lead` | `JnlZFAVmFAuNXVya` | 200 "Workflow was started" | yes (10456, error) | **yes** | `Auth Gate` threw |
| 9 | `slack-command` | `VmnIXo7tM30zqawp` | 200 + canned text | yes (10458, error) | **yes** | `Auth Gate` threw — **closed by design**, confirming the 6 Sep retraction |
| 10 | `whatsapp-send` | `yx6m55p1Kj8V7koR` | 200 + error JSON | yes (10460, success) | **yes** | `Auth OK?` → `Respond Unauthorized` |
| 11 | `whatsapp-inbound` | `BiyHk9ZXxJUVGbf6` | 200 "Workflow was started" | yes (10462–10469) | **no — gate DORMANT** | see item 7 |

**Ten refuse. One does not.** That reproduces the 3 September finding exactly,
now with `_gate` read directly rather than inferred from an absent key (see
item 7).

**`authentication: ABSENT` is proven behaviourally on all eleven**, which is
stronger than reading the parameter: n8n's own `authentication` rejects at the
webhook *without starting an execution*. Every one of the eleven started an
execution. Even `ask-ai`'s HTTP 401 came from a Respond node downstream, after
the execution began.

### Two findings the earlier passes did not record

**1. An anonymous caller writes to the dealership's audit trail, and it is
filed under the dealership.** The ten refusals produced **nine `audit_log`
rows**. Eight carry `tenant_id = fff6a2b5…` (Tenant A). Only `ask-ai` files the
refusal under the quarantine tenant `02c86264…` with
`"TENANT UNRESOLVED (unauthenticated)"`. So an unauthenticated stranger can
append unbounded rows to Tenant A's audit log at roughly one row per request. Today
that is noise on the Automation screen; with a second dealership onboarded it
is one dealership's screen filled with traffic that was never theirs.
**`ask-ai`'s behaviour is the correct pattern and the other eight should copy
it** — a refused anonymous request has no dealership.

**2. `deals/closed-won` answers HTTP 200 with an empty body.** It uses
`responseMode: responseNode`, and `Auth Gate` throws before any Respond node is
reached, so the caller gets a bare 200. A legitimate dashboard client cannot
distinguish "rejected" from "accepted" on that endpoint. Cosmetic for security,
material for the dashboard.

### Which control belongs on which — and what I did about each

**Three kinds of caller, three controls.** One mechanism for all eleven would be
wrong.

| endpoint(s) | correct control | status |
|---|---|---|
| `whatsapp-inbound` | **Shared secret.** Caller is WAHA, a server we control; it has no user session and can never obtain a JWT. The mechanism already exists in `WAHA Auth Gate` and is dormant. | **BLOCKED on owner** — needs `WAHA_WEBHOOK_SECRET` |
| `slack-command` | **Slack request signing** — HMAC-SHA256 over `'v0:' + X-Slack-Request-Timestamp + ':' + raw body`, ±5 min window. Slack cannot carry a Supabase JWT. | **Not scheduled.** No Slack integration exists to protect and no revenue behind it. The endpoint is closed by design today. |
| the other nine (`lead-trigger`, `ask-ai`, `finance-calc`, `audit-kyc`, `lead-escalation`, `nexus-inbound-lead`, `deals/closed-won`, `erp-sync`, `whatsapp-send`) | **The Supabase JWT they already carry, validated at the edge.** | **BLOCKED on owner** — Caddy + JWT secret, neither reachable from here |

**A shared secret is the wrong answer for those nine and must not be added.**
They are called by `apps/executive-dashboard`, a public JavaScript bundle.
Any secret compiled into it is published on the internet, and would be worse
than nothing because it would read as a control in an audit. The JWT is already
checked — `Verify JWT` → `GET /auth/v1/user` → refuse when no `.id` — and the
nine refusals above prove it works. **The JWT is not missing. Where it is
checked is the defect.**

Today an unauthenticated POST to any of the nine is accepted by Caddy, starts an
n8n execution, makes an outbound HTTPS round trip to Supabase, is refused
downstream, and leaves an execution row plus an `audit_log` row. That is a free
CPU and outbound-request amplifier on an e2-micro this project already records
as CPU-starved.

### What I implemented without a secret: nothing, and that is the finding

The honest answer to "implement what can be implemented without a secret" is
that **the correct control for all eleven requires either a secret or VM access,
and I hold neither.** The two things I could have done from here are both wrong
and I did neither:

- **Setting n8n's `authentication` parameter** (basic/header/JWT credential) on
  those nodes. n8n cannot validate a *Supabase* JWT against the project secret
  with the claims these workflows read, and header auth would put a shared
  secret back into the public bundle. Leave the parameter absent; fix it at the
  edge.
- **Hardcoding the WAHA secret in the n8n node.** This silently drops every real
  customer message, because WAHA is not sending the header — which I confirmed
  live, below.

### Item 5 — BLOCKED on the owner, precisely

1. **Edge JWT validation in Caddy**, in front of `/webhook/*`, for the nine
   dashboard paths only: verify the `Authorization: Bearer` signature against the
   Supabase project JWT secret and check `exp`. Local signature check, no network
   round trip. **`whatsapp-inbound` and `slack-command` must be excluded** — WAHA
   and Slack have no JWT, and catching `whatsapp-inbound` 401s every real
   customer message while WAHA keeps seeing a response and never backs off. That
   exclusion is the single most important line of the config. Rollback: remove
   the matcher block, `caddy reload`.
2. It buys a real 401 **before n8n is reached** — no execution, no CPU, no
   outbound request, no execution row, no anonymous `audit_log` row. It does
   **not** authenticate a *dealership*; the in-workflow
   `Tenant For JWT User` → `tenant_members` lookup stays.

---

## Item 6 — `channel_registry` tenant cutover: **BLOCKED**

**I did not deploy this, and the reason is the ordering rule, not the
difficulty.**

The cutover's own runbook states its precondition: *"Do 07 first… Before 07:
you have made the tenant map authoritative without making the caller authentic.
That is a worse state than today, because it looks finished."* Item 07 — arming
`WAHA_WEBHOOK_SECRET` — is blocked on the owner (below). My standing instruction
is that a traffic-affecting change whose stated precondition is unmet is
BLOCKED, not attempted.

Three further reasons that are mine rather than inherited:

- **It buys no tenant-boundary improvement today.** Item 7 proves the *current*
  published `Resolve Tenant` already fails closed on every forged input. The
  cutover moves where the map lives; it does not make `body.session`
  authentic. The security delta today is zero.
- **It adds an availability risk to the live inbound path.** It inserts a
  synchronous Supabase round trip into every inbound WhatsApp message on a
  CPU-starved box. The current env-map resolver cannot fail that way; the new
  one drops a real customer message on any Supabase blip or timeout — and
  because `Resolve Tenant` fails closed (correctly), the drop is silent.
- **Real customer traffic is flowing right now.** An inbound 1:1 message landed
  at 14:13:54 UTC mid-run, resolved to Tenant A. This is not a quiet box.

### What I did verify, so the owner knows the target is sound

The cutover depends on `nexus_resolve_channel_tenant` having set-returning,
fail-closed semantics. Measured on production:

| call | rows | result |
|---|---|---|
| `('whatsapp_waha_session','default')` | **1** | Tenant A `fff6a2b5…`, integration `75d67b05…` |
| `('whatsapp_waha_session','acme-motors')` | **0** | — |
| `('whatsapp_waha_session','')` | **0** | — |
| `('whatsapp_cloud_phone_number_id','default')` | **0** | — |

`channel_registry` holds exactly the row the cutover needs
(`external_identifier = 'default'` → Tenant A, `status = 'active'`), and
`external_identifier` matches the value live traffic actually carries. **The
target is correct and ready; only the sequencing is holding it.**

### Item 6 — what clears it

Complete item 07 (below). Then apply file `09` as written: an RPC lookup node
before `Resolve Tenant`, `tenant_source: 'channel_registry'`, and **keep the
fail-closed `return []` branch** — that branch is the node's entire purpose.
Ten-second rollback stays: disable the new lookup node and restore the
`$env.NEXUS_TENANT_MAP` / `BUILTIN` body, then republish. **Do not roll back by
disabling `Resolve Tenant` itself** — since 5 September that sends live Tenant A
traffic to the quarantine tenant, where the dealership cannot see it.

---

## Item 7 — can any caller-controlled value override the resolved tenant? **PASS**

### The door in front of it, measured live rather than inferred

From execution `10462`, on the `WAHA Auth Gate` output, my request arriving from
outside the VM:

```json
"x-forwarded-for": "160.79.106.131",
"_gate": { "mode": "DORMANT", "ok": false, "header_present": false, "enforcing": false }
```

`mode: "DORMANT"` read directly — no longer inferred from an absent `_gate` key.
**`POST /webhook/whatsapp-inbound` accepts unauthenticated calls from the open
internet today.** Corroborated independently: the probe's own read of
`/api/sessions/default` shows WAHA's webhook configured as
`{"url":"https://35.224.126.225.nip.io/webhook/whatsapp-inbound","events":["message"]}`
with **no `customHeaders`** — WAHA is not sending the secret header, which is
exactly why hardcoding the secret in n8n first would silently drop every real
customer message.

### The attacks

Eight forged requests, 14:20:40–14:21:04 UTC. **Every payload used a
`@g.us` sender**, so no branch of the workflow could send a WhatsApp message
whatever the resolver did — the evidence is *which node halted*, which
separates the outcomes exactly and risks nothing.

| # | forged input | `Resolve Tenant` output | halted at | verdict |
|---|---|---|---|---|
| A1 | `session:"default"` (control) | **1 item** — `tenant_id: fff6a2b5…`, `tenant_source:"waha_session"` | `Is Real Inbound?` | control holds |
| A2 | `session:"acme-motors"` (unknown) | **0 items** | **`Resolve Tenant`** | **PASS** |
| A3 | no `session` key at all | **0 items** | **`Resolve Tenant`** | **PASS** |
| A4 | `session:""` | **0 items** | **`Resolve Tenant`** | **PASS** |
| A5 | `session:"default"` + `tenant_id:"11111111-…"` in body | **1 item** — `tenant_id: fff6a2b5…`, `tenant_source:"waha_session"` | `Is Real Inbound?` | **PASS — forged tenant ignored** |
| A6 | `session:"acme-motors"` + valid Tenant A `tenant_id` in body | **0 items** | **`Resolve Tenant`** | **PASS — body cannot rescue an unknown session** |
| A7 | `session:"constructor"` | **0 items** | **`Resolve Tenant`** | **PASS — prototype guard holds** |
| A8 | `session:"toString"` | **0 items** | **`Resolve Tenant`** | **PASS** |

**Zero rows, everywhere:**

```
processed_messages    where message_id like 'NEXUSATTACK%'            -> 0
communication_logs    matching the probe text or the forged sender    -> 0
whatsapp_contacts     for the forged chat id                          -> 0
leads                 for the forged sender                           -> 0
totals unchanged across all eight: leads 3, communication_logs 116,
processed_messages 75, whatsapp_contacts 12
```

### Why it holds, from the published code

`Resolve Tenant` is an **allowlist that refuses rather than defaults**. It reads
the session from exactly one place —
`$('WAHA Webhook (POST)').first().json.body.session` — checks it with
`Object.prototype.hasOwnProperty.call(map, session)` (which is why `constructor`
and `toString` fail), requires the mapped value to match a UUID regex, and
otherwise `return []`. There is no `sole_configured_tenant` fallback on this
path.

The context is then **immutable downstream**: `Extract Message & Sender` takes
the webhook branch's tenant from `$('Resolve Tenant')` **and nothing else**,
with no fallback of any kind, and `if (!NEXUS_UUID.test(TENANT)) TENANT = null`.
A grep of all 47 published nodes for `body…tenant_id` returns **zero matches** —
no node anywhere reads a caller-supplied tenant on the webhook path.

**The required outcome for an unknown session — zero rows and a halted branch,
not a fallback to the only dealership — is met, and it is met today, before the
`channel_registry` cutover.**

### The honest limit on this PASS

This proves the *tenant resolver* cannot be overridden. It does **not** prove
the endpoint is safe, and the two must not be conflated:

- The gate is `DORMANT`, so an anonymous caller still starts an execution.
- With a **valid** session (`"default"` — a single well-known string) and a
  real 1:1 sender, an anonymous caller still reaches the write and reply path.
  My attacks deliberately used `@g.us` senders so as not to exercise that; it is
  unchanged and it is what item 07 closes.
- With one dealership configured, the resolver's allowlist has exactly one key.
  Its refusal behaviour is proven; its *discrimination* between two dealerships
  cannot be proven here, because `NEXUS_TENANT_MAP` is unset and only Tenant A
  exists.

---

## Blocked on the owner — the complete list

| # | what Ali must do | unblocks |
|---|---|---|
| 1 | **Permanently remove `2.50.10.149`.** **Identified 8 Sep 2026 as Ali's own Windows desktop `desktop-l3an0ma`, WAHA in Docker Desktop, the PC that used to host n8n behind `https://desktop-l3an0ma.tail2141f7.ts.net` — and measured still posting into production that morning:** execution 11103 at 06:07:40 UTC, `x-forwarded-for 2.50.10.149`, `WAHA/2026.7.1`, `me.jid …:8`, `body.event session.status`, no `x-nexus-webhook-secret`. The earlier samples missed it because they grouped by `payload.id` and that host's unauthenticated session emits only `session.status`, which can never pair — **absence of duplicates is not absence of the sender**. Its whole `nexus-os` compose project (`n8n`, `n8n-db`, `waha`) was **stopped by hand at 06:08:24 UTC**. Status: **identified, and stopped by hand on 8 Sep 2026 — not yet permanently removed (`restart: always` still declared, device 8 still linked)**. Close it with `docker update --restart=no n8n n8n-db waha` on that PC and by unlinking WhatsApp device **8**, then confirm from the box that no `me.jid …:8` delivery arrives — reading all events, not duplicate pairs. Configuring it instead now buys nothing: with an unauthenticated session it captures no messages. | item 07, then item 6 |
| 2 | **`WAHA_WEBHOOK_SECRET=<32+ random chars>` in `/opt/nexus/.env`, `WAHA_WEBHOOK_ENFORCE` NOT set, restart n8n.** Then make the box's WAHA send the header (`.149` no longer applies — stopped 8 Sep, unauthenticated session, no messages to lose). **8 Sep 2026: this is stuck at the confirm step** — the gate reads `header_present: true, ok: false` on the box's own traffic, because the box is in queue mode and the Code node comparing `$env.WAHA_WEBHOOK_SECRET` runs in `n8n-worker`, which `docker compose up -d n8n` does not recreate. Then confirm in saved executions that `_gate` reads `mode:"MONITOR", header_present:true, ok:true` from every source address, on at least one genuine 1:1 customer message. **Only then** set `WAHA_WEBHOOK_ENFORCE=true`, restart, and send one real WhatsApp from a handset and confirm a reply. **The order is the whole risk: doing this in the n8n node instead of the VM env silently drops every real customer message, and WAHA keeps seeing 200.** | closes the open webhook; item 6 |
| 3 | **`NEXUS_PROBE_KEY=<24+ random chars>` on the VM**, restart n8n, then re-enable the `Probe Webhook` node and republish — only if the on-demand status URL is wanted. Do **not** set `NEXUS_PROBE_VERBOSE=true`. | the probe's GET endpoint |
| 4 | **Edge JWT validation in Caddy** for the nine dashboard paths, excluding `whatsapp-inbound` and `slack-command`. | item 5 |
| 5 | **Decide Phase 6**: fix `Fetch Rep Slack Id` in `KI6P1Qcf3MIZakNa` (guard the null `assigned_to_id`; move it before `Send a message`/`Return Result`), re-run manually, then publish — or correct `workflow_registry.is_active` to `false`. Leaving it is the only option that keeps a live screen saying something false. | item 4b |
| 6 | **`NEXUS_TENANT_MAP` two-key switch rehearsed on a staging box** before production. Not required for anything above; required before dealership two. | onboarding |

---

## Standing checks, after this pass

```sql
select * from public.nexus_quarantine_census();   -- 1 row
select * from public.nexus_tenancy_readiness();   -- 0 BLOCKERs (3 WARN, 4 INFO)
```

**The census is no longer empty, and I caused it.** The one row is
`audit_log`, newest `2026-09-06 14:19:00.131+00` — the `ask-ai` refusal from my
own item-5 probe, filed under the quarantine tenant with
`"TENANT UNRESOLVED (unauthenticated)"`. That is the quarantine mechanism
working exactly as designed: an unattributable anonymous request retained
visibly rather than filed under Tenant A. It is not a workflow that forgot its
`tenant_id`. Recorded here so the next daily census does not chase a ghost;
`nexus_tenancy_readiness` surfaces it as the third WARN.

Zero BLOCKERs on production, unchanged by this pass.
