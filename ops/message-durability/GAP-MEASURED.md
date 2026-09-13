# The message-durability gap, measured

**9 September 2026. Production `dsvuoovivysszdoiorch`, read-only throughout.**
Nothing in this file was written to any database. No n8n API call was made from
here; every n8n statement below is read from workflow JSON in this repository and
is marked as such.

Companion to `P0-CLAIMED-NEVER-LOGGED.md`, which measured the **inbound** half.
This file measures the **outbound** half and re-measures the inbound number,
which has moved — not because anything was fixed.

---

## 0. The headline: the evidence of the P0 is on a seven-day timer

`P0-CLAIMED-NEVER-LOGGED.md §4.2` ran the invariant on 8 September and got:

```
6 claimed message(s) with no record, in 4 conversation(s):
158510264357112@lid (6/3), 184984711217354@lid (1/0),
204479249027311@lid (3/2), 210097552777273@lid (1/0)
```

The same body, run today, 9 September:

```sql
-- P0 §4.1 invariant 1, verbatim body, run as a plain SELECT
-- 5 | 3 | 158510264357112@lid (6/3), 184984711217354@lid (1/0), 204479249027311@lid (3/2)
```

**Six became five. `210097552777273@lid` is gone, and it was not recovered.**

```sql
select min(processed_at)::text, max(processed_at)::text, count(*),
       (now() - interval '7 days')::text
  from processed_messages;
-- 2026-09-02 06:07:09.584087+00 | 2026-09-08 17:24:34.794258+00 | 36 | 2026-09-02 03:43:18+00
```

The claim that proved the loss was `2026-09-01 10:26:44.942502+00`. It is below
the cutoff. The deleter is first-party, in this repository:

`n8n-workflows/nexus_retention_purge.json`, node **`Prune Dedupe Guard`**:

```
DELETE /rest/v1/processed_messages?processed_at=lt.{{ $now.minus(7,'days') }}
```

`processed_messages` was 41 rows when the P0 was written and is **36** now.
`communication_logs` is not purged by that workflow (its only deletes target
`kyc_documents` and Storage) and has grown 137 → 142.

**The consequence, stated plainly.** The only durable trace that a message was
ever *seen* has a 7-day TTL, and the table that survives carries no message id
to join it to. So the P0's own invariant **goes green on its own** around
15 September with nothing fixed — the last surviving affected claim
(`184984711217354@lid`, `2026-09-04 06:21:37`) is deleted on 11 September. A
gate that self-heals by forgetting is worse than a gate that stays red.

This is not a new defect. It is the same defect: *a send or a receipt that
leaves no durable row is indistinguishable from one that never happened*, and
here the row that did exist is deleted on schedule.

---

## 1. Every message-ish table on production today

Found by enumerating `pg_class` in `public`, not by assuming. Counts are exact
`count(*)`, run today.

| table | rows | earliest | latest | who writes it | is it a durable per-message record? |
|---|---|---|---|---|---|
| `communication_logs` | **142** | 2026-08-25 05:04:15Z | 2026-09-08 17:25:55Z | six n8n workflows via PostgREST | text yes, identity no (§2) |
| `processed_messages` | **36** | 2026-09-02 06:07:09Z | 2026-09-08 17:24:34Z | `Claim Message Id` (BDC agent) | no — dedupe guard, **7-day TTL** |
| `channel_message_events` | **0** | — | — | `nexus_record_channel_event`; the Cloud receiver calls it | designed for it, never written |
| `channel_send_directive` | **0** | — | — | `nexus_request_send` / `nexus_record_send_result` | designed for it, never written |
| `whatsapp_delivery_events` | **0** | — | — | `whatsapp_record_delivery_status` | never written |
| `whatsapp_customer_message_seen` | **0** | — | — | `whatsapp_record_customer_message` | never written |
| `whatsapp_message_usage` | **0** | — | — | `whatsapp_record_message_usage` | never written |
| `whatsapp_conversation_state` | **0** | — | — | as above | never written |
| `whatsapp_message_intent` | 4 | — | — | seed | catalogue, not messages |
| `whatsapp_opt_in_event` | **0** | — | — | — | never written |
| `whatsapp_contacts` | 14 | — | — | `Upsert WhatsApp Contact` | per-person, not per-message |
| `audit_log` | 898 | — | 2026-09-09 01:00:36Z | every workflow's `Audit Log` node | per-**run**, carries no message id |
| `kyc_documents` | 3 | — | — | KYC branch | per-document |
| `channel_registry` | 2 | — | — | seed | both ALBA: WAHA `default`, Cloud `1306545252542419` |
| `channel_send_form` | 9 | — | — | seed | catalogue |

**Six of the seven purpose-built messaging tables hold zero rows.** Every claim
about their behaviour — including the ones in this repository's own specs — is a
claim about code that has never processed a real message. `NOT RUN`, not `PASS`.

### 1.1 Per-tenant distribution

```sql
select t.slug,
       (select count(*) from communication_logs c where c.tenant_id=t.id) comm,
       (select count(*) from processed_messages p where p.tenant_id=t.id) claims
  from tenants t;
-- alba-cars        | 141 | 36
-- __unattributed__ |   1 |  0
```

One real dealership. Multi-tenant behaviour of every table above is **NOT
MEASURED** — there is no second tenant with messages to measure it against.

### 1.2 `communication_logs`, the only thing actually written

```sql
select channel, direction, count(*),
       count(*) filter (where external_message_id is not null) as extmsg
  from communication_logs group by 1,2 order by 3 desc;
-- whatsapp | inbound  | 109 | 0
-- whatsapp | outbound |  28 | 0
-- system   | outbound |   3 | 0
-- system   | internal |   2 | 0
```

**0 of 142 carry an `external_message_id`** — 0 of 137 on the WhatsApp rows.
Worse than `ops/n8n-bundle-NOT-DEPLOYED/03-*` recorded (0 of 114) and than the
WIRING-SPEC recorded (0 of 142 on 8 Sep; same ratio, more rows). The unique index
`communication_logs_external_identity_key` has never collided on anything.

Its full column list is twelve columns:
`id, lead_email, channel, direction, message, created_at, sent_by, tenant_id,
external_message_id, channel_key, direction_key, evidence_state`.

**There is no status column, no provider id, no error column, and no attempt
column.** An outbound row asserts that something was said. It cannot assert that
it arrived, that it was accepted, or that it was even attempted.

```sql
select sent_by, direction, evidence_state, count(*) from communication_logs group by 1,2,3;
-- (null) | inbound  | ADMISSIBLE  | 109
-- bot    | outbound | ADMISSIBLE  |  17
-- (null) | outbound | ADMISSIBLE  |   8
-- bot    | outbound | QUARANTINED |   6
-- (null) | internal | ADMISSIBLE  |   2
```

`evidence_state` is an attribution grade, not a delivery outcome.

---

## 2. Which send paths write nothing

### 2.1 Every send call site in the repository

Enumerated by parsing all `n8n-workflows/*.json` for HTTP nodes whose URL matches
a send API, plus every Gmail/Slack node; then by grepping `apps/` and every `.py`
in the repo. The WhatsApp list matches `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md §1b`
independently — same six WAHA call sites, found by a different method.

| # | call site | provider | verdict | evidence |
|---|---|---|---|---|
| 1 | `n8n-workflows/whatsapp_bdc_ai_agent.json` → `Send Reply via WAHA HTTP API` | WAHA | **writes a row that cannot be checked, and writes it whether or not the send worked** | `onError: continueRegularOutput`; the error item leaves output 0 into `Log Conversation`, whose body is `{lead_email, channel:'whatsapp', direction:'outbound', message: $('Guard Reply')…output, sent_by:'bot'}` — no id, no status, and no reference to the send node's result |
| 2 | `n8n-workflows/whatsapp_send_dashboard_reply.json` → `Send via WAHA` | WAHA | **writes NOTHING when the send fails** | `onError: continueErrorOutput`; output 1 → `Respond Send Failed`, a `set` node, terminal. Its own text: *"Nothing was sent and nothing was logged — the message is still unsent."* On success, output 0 → `Log Outbound`, again with no id and no status |
| 3 | `7_day_warm_lead_drip_campaign.json` → `WhatsApp: Welcome` | WAHA | writes an unconditional row | `onError: continueRegularOutput` → `Log WhatsApp Welcome`, body `message:'Drip Day 1 - WhatsApp welcome'`, no id, no status |
| 4 | `7_day_warm_lead_drip_campaign.json` → `WhatsApp: Check-in` | WAHA | same | same shape |
| 5 | `kyc_aml_document_auditor_re_upload_loop_phase_5.json` → `WhatsApp: Request Re-upload` | WAHA | writes a row; outcome only as **prose inside the message text** | body appends `'[delivery: ' + $json.delivery.status + ' - ' + …note + ']'` — the only send outcome persisted anywhere on production, and it is a substring of a free-text column |
| 6 | `kyc_aml_document_auditor_re_upload_loop_phase_5.json` → `WhatsApp: KYC Approved` | WAHA | same | same |
| 7 | `7_day_warm_lead_drip_campaign.json` → three Gmail nodes | Gmail | writes an unconditional `channel:'email'` row | `Log Welcome Email` / `Log Follow Up Email` / `Log Final Offer Email`. Production holds **zero** `channel='email'` rows, so this path is designed-but-unexercised |
| 8 | `lead_escalation_ai_agent.json` → `Email: Escalation Alert (Gmail)` | Gmail | `audit_log` row only, no `communication_logs` row | staff-facing, not customer-facing |
| 9 | `nexus_master_lead_router_ai_agent.json`, `nexus_retention_purge.json`, `customer_360_data_aggregation_bitrix24.json` → Slack nodes | Slack | **writes nothing per message** | staff-facing |
| 10 | WhatsApp **Cloud** outbound | Cloud | **no send node exists** | `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md` — "the Cloud receiver only receives" |
| 11 | dashboard `screens/conversations.js:2949` → `n8n(HOOK.whatsappSend, …)` → call site 2 | WAHA | **the operator is told the truth and the database is not** | on `status === 'error'` it renders *"Nothing left the dealership number"*; on an unrecognised shape it renders *"whether the message left cannot be told from here. Check WhatsApp before sending again."* Both branches persist nothing |
| 12 | Python | — | **no send call sites** | `grep -rn "sendText\|graph.facebook.com\|twilio\|smtplib" --include=*.py` returns nothing outside `node_modules` |

**Summary of the outbound gap:**

- **0 of 6** WhatsApp send call sites capture the provider's message id. Confirmed
  independently by the database: 0 of 142 rows carry one.
- **0 of 6** persist a send outcome as data. One (call site 5) persists it as English
  inside the message body.
- **1 of 6** (call site 2, the human reply from the Conversations screen) persists
  **nothing at all** on failure. That is the salesperson's own send.
- **5 of 6** write an outbound "we said this" row *even when the send failed*,
  because `onError: continueRegularOutput` routes the error item down the same
  main output the log node hangs off. So the two failure modes are both live and
  they are opposites: **sent-and-not-logged** (call site 2) and
  **logged-and-not-sent** (call sites 1, 3, 4, 5, 6).

### 2.2 The outcome vocabulary that exists, and dies in the browser

Every one of these workflows contains a `Delivery Report` Code node computing
`SUCCESS` / `PARTIAL` / `FAILED` from which claimed nodes actually produced
items. It is a good idea. Its output reaches `audit_log.status` **per run**, and
in call site 2 it reaches the dashboard as `status: 'sent' | 'sent_but_not_logged'`
in an HTTP response body.

`sent_but_not_logged` is a string a browser sees once and nothing stores.

### 2.3 What can be answered today about "did you contact this customer?"

| question | answerable today? |
|---|---|
| did we send them anything, ever | only if a `communication_logs` outbound row exists — which is written on failure too |
| did the provider accept it | **no** |
| what id did the provider give it | **no** — 0 of 142 |
| did it get delivered / read | **no** — `whatsapp_delivery_events` is empty and nothing can link to it |
| did a send fail, and why | **no** — except as prose inside two KYC message bodies |
| did we decline to send, and under what rule | **no** — `channel_send_directive` has 0 rows |
| how much did it cost | **no** — `whatsapp_message_usage.event_id` is a NOT NULL FK to an empty table |

---

## 3. What already exists, and why a fourth ledger would be the wrong answer

Three ledgers exist for this. Two have never held a row.

### 3.1 `channel_message_events` — exists, correct, empty, and cannot hold a failure

19 columns, 16 constraints, 5 indexes, RLS `FORCE`, `service_role` only. Full
shape is measured in `ops/channel-events/WIRING-SPEC.md §1` and re-confirmed
today. The two facts that matter here:

- `external_message_id` is **NOT NULL**, and `cme_extmsg_is_a_provider_id`
  requires it to look like a provider id. **A send that the provider rejected has
  no provider id.** So the table structurally refuses the row people actually
  need. It is a ledger of things that *succeeded*.
- there is **no append-only trigger** on it:

```sql
select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where not t.tgisinternal and c.relname in
   ('channel_message_events','whatsapp_delivery_events','channel_send_directive','communication_logs');
-- channel_send_directive   | channel_send_directive_guard_policy_citation
-- communication_logs       | trg_comm_logs_first_response
-- whatsapp_delivery_events | whatsapp_delivery_events_append_only
-- whatsapp_delivery_events | whatsapp_delivery_events_guard_link
```

Its sibling is append-only. It is not. `service_role` holds
`DELETE, TRUNCATE, UPDATE` on it and nothing stops their use — which, given §0,
is not a theoretical concern in this system.

### 3.2 `channel_send_directive` — the send-outcome vocabulary already exists

49 columns, 0 rows. It already contains the exact answer to "what is stored when
a send fails": `provider_message_id`, `provider_error_code`,
`provider_error_detail`, `result_recorded_at`, and

```sql
-- pg_get_constraintdef('csd_send_result_check')
CHECK (send_result = ANY (ARRAY['PENDING','ACCEPTED_BY_PROVIDER',
                                'REJECTED_BY_PROVIDER','NOT_ATTEMPTED','TRANSPORT_ERROR']))
```

**This is the vocabulary. It is defined in a CHECK constraint on one table, and
nothing else in the database can see it.** That is precisely the
`ops/f2-tenant-rule/RECONCILIATION.md` shape: a producer's vocabulary invisible to
its consumers, waiting for someone to spell it slightly differently.

The same table shows the failure has already started:

```sql
-- FKs referencing the catalogue tables
-- channel_provider_capability.send_form -> channel_send_form(code)     EXISTS
-- channel_send_directive.requested_send_form -> channel_send_form(code) DOES NOT EXIST
-- channel_send_directive.resolved_send_form  -> channel_send_form(code) DOES NOT EXIST
```

`channel_send_form` is a 9-row catalogue with a `code` primary key. One table FKs
to it. The table that *routes sends* does not — those two columns are unconstrained
text next to a catalogue that would have caught a typo.

### 3.3 The precedent this repository already set, and which works

```sql
-- pg_constraint, contype='f', referenced = lead_provenance_kind
lead_event.(origin_verified, provenance_counts_as_real)
   -> lead_provenance_kind(kind, counts_as_real)          ON DELETE RESTRICT
lead_ingest_endpoint.(declared_provenance, provenance_counts_as_real)
   -> lead_provenance_kind(kind, counts_as_real)          ON DELETE RESTRICT
lead_source_catalogue.required_provenance
   -> lead_provenance_kind(kind)                          ON DELETE RESTRICT
```

A **composite** foreign key carrying the derived property alongside the code. A
writer emitting an unknown `origin_verified` fails `23503`. A writer emitting a
known code with the wrong classification fails `23503`. A consumer asking "which
of these count as real" joins the catalogue instead of hardcoding an array. This
is the answer to the f2 failure mode, and it is already in this schema. §4 of
`DESIGN.md` reuses it.

### 3.4 `communication_logs` must not be replaced

Re-measured, agreeing with `ops/channel-events/WIRING-SPEC.md §4.2` and adding
one reason:

1. it holds the **body**; `channel_message_events` has no body column and a
   constraint (`media_ref !~ '^data:'`) forbidding content;
2. it holds `channel='system'` (5) and `direction='internal'` (2), both refused by
   `channel_message_events`' vocabulary, plus a designed `channel='email'` path;
3. no backfill exists — 0 of 142 have a provider id, and minting one is exactly
   what `cme_extmsg_is_a_provider_id` exists to refuse;
4. **it carries `trg_comm_logs_first_response AFTER INSERT FOR EACH ROW`**, which
   sets `leads.response_time_minutes`. A view cannot carry that trigger.

**Coexist, joined — not replaced, not fed one-way.** See `DESIGN.md §6`.

---

## 4. Unknowns, stated as unknowns

- **Whether the deployed n8n definitions still match the repository JSON.** The
  export is 30 August. `ops/n8n-waha-gate/prefilter.assignments.md` proves the box
  has nodes the export does not. Every §2.1 verdict is *"as exported"*. Not
  measured on the box; I am forbidden to touch n8n.
- **How many sends have actually failed.** UNKNOWN, not zero. No row records it.
  The only trace is n8n execution history, which I may not read.
- **Whether the Cloud receiver has ever run.** `channel_message_events` is empty,
  which is consistent with "never ran" and with "ran and was refused by
  `channel_message_events_customer_phone_is_digits_or_null`" — the receiver sends
  `'+' + customer_wa_id` (`ops/n8n-whatsapp-cloud/receiver.sdk.js:265`) into a
  `^[0-9]{6,20}$` column. Both are consistent with zero rows.
- **Multi-tenant behaviour.** One tenant has messages. NOT MEASURED.
- **Whether any of the 28 outbound `communication_logs` rows correspond to a send
  that failed.** Unanswerable — that is the finding.
